import Phaser from "phaser";
import { COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel } from "../ui";
import { takeScreenshot } from "../screenshot";
import { playTone } from "../audio";
import {
  CAMPAIGN_PHASE_KEY,
  highscoreKey,
  type Difficulty,
  type GameMode,
} from "./MenuScene";

const COLS = 40;
const ROWS = 30;
const CELL = 20;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const SCORE_PER_FOOD = 10;
const SCORE_PER_GOLDEN = 50;
const GOLDEN_TTL_MS = 4500;
const GOLDEN_BLINK_BELOW_MS = 1500;

interface SceneInitData {
  mode?: GameMode;
  phase?: number;
  difficulty?: Difficulty;
}

interface PhaseRules {
  tickMs: number;
  wrapAround: boolean;
  obstacles: number;
  accelPerFood: number; // ms a reduzir do tickMs por comida
  minTickMs: number;
  goldenChance: number; // 0..1 chance da próxima comida ser dourada
  scoreTarget: number; // 0 = sem alvo (clássico)
}

const CLASSIC_RULES: Record<Difficulty, PhaseRules> = {
  calm:   { tickMs: 140, wrapAround: false, obstacles: 0, accelPerFood: 0, minTickMs: 140, goldenChance: 0, scoreTarget: 0 },
  normal: { tickMs: 110, wrapAround: false, obstacles: 0, accelPerFood: 0, minTickMs: 110, goldenChance: 0, scoreTarget: 0 },
  fast:   { tickMs: 80,  wrapAround: false, obstacles: 0, accelPerFood: 0, minTickMs: 80,  goldenChance: 0, scoreTarget: 0 },
};

const CAMPAIGN_RULES: PhaseRules[] = [
  { tickMs: 120, wrapAround: false, obstacles: 0, accelPerFood: 0,   minTickMs: 120, goldenChance: 0,    scoreTarget: 20 },
  { tickMs: 110, wrapAround: true,  obstacles: 0, accelPerFood: 0,   minTickMs: 110, goldenChance: 0,    scoreTarget: 35 },
  { tickMs: 105, wrapAround: true,  obstacles: 7, accelPerFood: 0,   minTickMs: 105, goldenChance: 0,    scoreTarget: 55 },
  { tickMs: 110, wrapAround: true,  obstacles: 7, accelPerFood: 1.5, minTickMs: 60,  goldenChance: 0,    scoreTarget: 85 },
  { tickMs: 105, wrapAround: true,  obstacles: 8, accelPerFood: 1.0, minTickMs: 55,  goldenChance: 0.25, scoreTarget: 150 },
];

type Cell = { x: number; y: number };
type Direction = { x: number; y: number };
type FoodKind = "normal" | "golden";
type State = "start" | "playing" | "paused" | "gameover" | "phasecleared" | "campaigncomplete";

const DIR_UP: Direction = { x: 0, y: -1 };
const DIR_DOWN: Direction = { x: 0, y: 1 };
const DIR_LEFT: Direction = { x: -1, y: 0 };
const DIR_RIGHT: Direction = { x: 1, y: 0 };

export class SnakeScene extends Phaser.Scene {
  private mode: GameMode = "classic";
  private difficulty: Difficulty = "normal";
  private phase = 1;
  private rules: PhaseRules = CLASSIC_RULES.normal;

  private snake: Cell[] = [];
  private food: Cell = { x: -1, y: -1 };
  private foodKind: FoodKind = "normal";
  private foodSpawnedAt = 0;
  private obstacles: Cell[] = [];

  private currentDirection: Direction = DIR_RIGHT;
  private nextDirection: Direction = DIR_RIGHT;
  private tickAccumulator = 0;
  private currentTickMs = 110;
  private foodsEaten = 0;
  private score = 0;
  private highScore = 0;
  private state: State = "start";

  private snakeGraphics!: Phaser.GameObjects.Graphics;
  private foodGraphics!: Phaser.GameObjects.Graphics;
  private obstaclesGraphics!: Phaser.GameObjects.Graphics;

  private statusLabel!: Phaser.GameObjects.Text;
  private targetLabel!: Phaser.GameObjects.Text;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlaySubtitle!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private keys!: Record<
    "UP" | "DOWN" | "LEFT" | "RIGHT" | "W" | "A" | "S" | "D" | "SPACE" | "R" | "P" | "K" | "ESC",
    Phaser.Input.Keyboard.Key
  >;

  constructor() {
    super("snake");
  }

  init(data: SceneInitData) {
    this.mode = data.mode ?? "classic";
    this.difficulty = data.difficulty ?? "normal";
    this.phase = data.phase ?? 1;
    this.rules = this.mode === "campaign" ? CAMPAIGN_RULES[this.phase - 1] : CLASSIC_RULES[this.difficulty];
    this.highScore = this.loadHighScore();
    this.score = 0;
    this.foodsEaten = 0;
    this.currentTickMs = this.rules.tickMs;
    this.state = "start";
  }

  create() {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLOR_HEX.bg);
    drawDiagonalScanlines(this, WIDTH, HEIGHT, 20, 0.035);
    this.drawGridLines();

    this.obstaclesGraphics = this.add.graphics();
    this.snakeGraphics = this.add.graphics();
    this.foodGraphics = this.add.graphics();

    this.drawChrome();
    this.drawOverlay();

    const kb = this.input.keyboard!;
    this.keys = {
      UP: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      DOWN: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      LEFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      RIGHT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      R: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      P: kb.addKey(Phaser.Input.Keyboard.KeyCodes.P),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      ESC: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
    };

    this.refreshStatus();
    this.showStartScreen();
  }

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.K)) {
      takeScreenshot(this.game, `gamedev-03-snake-${this.mode}`);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      this.scene.start("menu");
      return;
    }

    this.handleStateInput();

    if (this.state === "playing") {
      this.tickAccumulator += delta;
      while (this.tickAccumulator >= this.currentTickMs) {
        this.tickAccumulator -= this.currentTickMs;
        this.step();
        if (this.state !== "playing") break;
      }
      if (this.foodKind === "golden" && time - this.foodSpawnedAt > GOLDEN_TTL_MS) {
        this.spawnFood();
      }
      this.draw(time);
    }
  }

  // ---------- chrome ----------

  private drawChrome() {
    addCornerLabel(this, 22, 22, "/ 03", "SNAKE", false);
    createPulsingDot(this, WIDTH - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    this.statusLabel = this.add
      .text(WIDTH - 38, 22, "", TEXT_PRESETS.monoLabel)
      .setOrigin(1, 0);
    this.targetLabel = this.add
      .text(WIDTH - 22, 44, "", TEXT_PRESETS.hint)
      .setOrigin(1, 0);

    this.add.text(22, HEIGHT - 22, this.bottomLeftChrome(), TEXT_PRESETS.hint).setOrigin(0, 1);
    this.add.text(WIDTH - 22, HEIGHT - 22, "ESC MENU · P PAUSAR · K SCREENSHOT", TEXT_PRESETS.hint).setOrigin(1, 1);
  }

  private bottomLeftChrome(): string {
    if (this.mode === "campaign") return `GAMEDEV.03 · CAMPANHA F${this.phase}`;
    return `GAMEDEV.03 · CLÁSSICO ${this.difficulty.toUpperCase()}`;
  }

  private drawOverlay() {
    this.overlayBg = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLOR_HEX.bg, 0.82);
    this.overlayTitle = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 80, "", TEXT_PRESETS.heroOutline)
      .setOrigin(0.5)
      .setFontSize("88px");
    this.overlaySubtitle = this.add
      .text(WIDTH / 2, HEIGHT / 2, "", TEXT_PRESETS.body)
      .setOrigin(0.5);
    this.overlayHint = this.add
      .text(WIDTH / 2, HEIGHT / 2 + 56, "", TEXT_PRESETS.hint)
      .setOrigin(0.5);
  }

  private hideOverlay() {
    this.overlayBg.setVisible(false);
    this.overlayTitle.setVisible(false);
    this.overlaySubtitle.setVisible(false);
    this.overlayHint.setVisible(false);
  }

  private showOverlay() {
    this.overlayBg.setVisible(true);
    this.overlayTitle.setVisible(true);
    this.overlaySubtitle.setVisible(true);
    this.overlayHint.setVisible(true);
  }

  private refreshStatus() {
    this.statusLabel.setText(`SCORE ${String(this.score).padStart(3, "0")} · HIGH ${String(Math.max(this.score, this.highScore)).padStart(3, "0")}`);
    if (this.rules.scoreTarget > 0) {
      this.targetLabel.setText(`META ${this.rules.scoreTarget}`);
    } else {
      this.targetLabel.setText("");
    }
  }

  // ---------- estados ----------

  private showStartScreen() {
    this.state = "start";
    this.showOverlay();
    if (this.mode === "campaign") {
      this.overlayTitle.setText(`FASE ${String(this.phase).padStart(2, "0")}`);
      this.overlaySubtitle.setText(this.phaseDescription(this.phase) + `  ·  meta ${this.rules.scoreTarget}`);
    } else {
      this.overlayTitle.setText("SNAKE");
      this.overlaySubtitle.setText(`clássico · ${this.difficulty.toUpperCase()}  ·  high ${this.highScore}`);
    }
    this.overlayHint.setText("ESPAÇO COMEÇAR  ·  ESC MENU");
  }

  private phaseDescription(phase: number): string {
    switch (phase) {
      case 1: return "clássico: paredes matam";
      case 2: return "wrap: paredes teleportam";
      case 3: return "wrap + obstáculos";
      case 4: return "wrap + obstáculos + cobra acelera ao comer";
      case 5: return "tudo + comida dourada (50pts, expira)";
      default: return "";
    }
  }

  private startGame() {
    this.snake = [
      { x: 12, y: 15 },
      { x: 11, y: 15 },
      { x: 10, y: 15 },
    ];
    this.currentDirection = DIR_RIGHT;
    this.nextDirection = DIR_RIGHT;
    this.score = 0;
    this.foodsEaten = 0;
    this.currentTickMs = this.rules.tickMs;
    this.tickAccumulator = 0;

    this.spawnObstacles();
    this.spawnFood();

    this.state = "playing";
    this.hideOverlay();
    this.refreshStatus();
    this.draw(this.time.now);
  }

  private handleStateInput() {
    const justDown = Phaser.Input.Keyboard.JustDown;

    if (justDown(this.keys.UP) || justDown(this.keys.W)) this.tryTurn(DIR_UP);
    else if (justDown(this.keys.DOWN) || justDown(this.keys.S)) this.tryTurn(DIR_DOWN);
    else if (justDown(this.keys.LEFT) || justDown(this.keys.A)) this.tryTurn(DIR_LEFT);
    else if (justDown(this.keys.RIGHT) || justDown(this.keys.D)) this.tryTurn(DIR_RIGHT);

    if (this.state === "start" && justDown(this.keys.SPACE)) {
      this.startGame();
    } else if (this.state === "playing" && justDown(this.keys.P)) {
      this.state = "paused";
      this.overlayTitle.setText("PAUSADO");
      this.overlaySubtitle.setText("");
      this.overlayHint.setText("P CONTINUAR  ·  ESC MENU");
      this.showOverlay();
    } else if (this.state === "paused" && justDown(this.keys.P)) {
      this.state = "playing";
      this.hideOverlay();
    } else if (this.state === "gameover" && justDown(this.keys.R)) {
      this.startGame();
    } else if (this.state === "phasecleared" && justDown(this.keys.SPACE)) {
      this.scene.start("snake", { mode: "campaign", phase: this.phase + 1 });
    } else if (this.state === "campaigncomplete" && justDown(this.keys.SPACE)) {
      this.scene.start("menu");
    }
  }

  private tryTurn(dir: Direction) {
    if (dir.x === -this.currentDirection.x && dir.y === -this.currentDirection.y) return;
    this.nextDirection = dir;
  }

  // ---------- loop principal ----------

  private step() {
    this.currentDirection = this.nextDirection;
    const head = this.snake[0];
    let newHead: Cell = {
      x: head.x + this.currentDirection.x,
      y: head.y + this.currentDirection.y,
    };

    if (this.rules.wrapAround) {
      newHead.x = (newHead.x + COLS) % COLS;
      newHead.y = (newHead.y + ROWS) % ROWS;
    } else if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
      this.gameOver();
      return;
    }

    for (const obs of this.obstacles) {
      if (obs.x === newHead.x && obs.y === newHead.y) {
        this.gameOver();
        return;
      }
    }

    const willEat = newHead.x === this.food.x && newHead.y === this.food.y;
    const bodyToCheck = willEat ? this.snake : this.snake.slice(0, -1);
    for (const segment of bodyToCheck) {
      if (segment.x === newHead.x && segment.y === newHead.y) {
        this.gameOver();
        return;
      }
    }

    this.snake.unshift(newHead);

    if (willEat) {
      const gained = this.foodKind === "golden" ? SCORE_PER_GOLDEN : SCORE_PER_FOOD;
      this.score += gained;
      this.foodsEaten++;
      this.refreshStatus();

      playTone(this.foodKind === "golden" ? 880 : 660, 90, "triangle", 0.13);
      this.cameras.main.flash(70, 245, 100, 30, false);

      if (this.rules.accelPerFood > 0) {
        this.currentTickMs = Math.max(this.rules.minTickMs, this.currentTickMs - this.rules.accelPerFood);
      }

      if (this.rules.scoreTarget > 0 && this.score >= this.rules.scoreTarget) {
        this.phaseCleared();
        return;
      }

      this.spawnFood();
    } else {
      this.snake.pop();
    }
  }

  // ---------- spawn ----------

  private spawnObstacles() {
    this.obstacles = [];
    if (this.rules.obstacles === 0) return;

    const occupied = new Set<string>();
    // não spawnar perto da cabeça/cobra
    for (const c of this.snake) occupied.add(`${c.x},${c.y}`);
    // protege uma faixa horizontal central pra cobra se mover
    for (let x = 6; x <= 16; x++) for (let y = 14; y <= 16; y++) occupied.add(`${x},${y}`);

    let attempts = 0;
    while (this.obstacles.length < this.rules.obstacles && attempts < 200) {
      attempts++;
      const c: Cell = {
        x: Phaser.Math.Between(2, COLS - 3),
        y: Phaser.Math.Between(2, ROWS - 3),
      };
      const key = `${c.x},${c.y}`;
      if (occupied.has(key)) continue;
      this.obstacles.push(c);
      occupied.add(key);
    }
  }

  private spawnFood() {
    const occupied = new Set<string>();
    for (const c of this.snake) occupied.add(`${c.x},${c.y}`);
    for (const c of this.obstacles) occupied.add(`${c.x},${c.y}`);

    if (occupied.size >= COLS * ROWS) {
      this.food = { x: -1, y: -1 };
      return;
    }

    let candidate: Cell;
    do {
      candidate = {
        x: Phaser.Math.Between(0, COLS - 1),
        y: Phaser.Math.Between(0, ROWS - 1),
      };
    } while (occupied.has(`${candidate.x},${candidate.y}`));

    this.food = candidate;
    this.foodKind = this.rules.goldenChance > 0 && Math.random() < this.rules.goldenChance ? "golden" : "normal";
    this.foodSpawnedAt = this.time.now;
  }

  // ---------- desenho ----------

  private drawGridLines() {
    const g = this.add.graphics();
    g.lineStyle(1, COLOR_HEX.border, 0.4);
    for (let x = 0; x <= COLS; x++) g.lineBetween(x * CELL, 0, x * CELL, HEIGHT);
    for (let y = 0; y <= ROWS; y++) g.lineBetween(0, y * CELL, WIDTH, y * CELL);

    this.drawObstaclesOnce();
  }

  private drawObstaclesOnce() {
    // chamado uma vez no início; obstáculos só mudam ao restartar
  }

  private draw(time: number) {
    this.obstaclesGraphics.clear();
    this.obstaclesGraphics.fillStyle(COLOR_HEX.border, 1);
    for (const obs of this.obstacles) {
      this.obstaclesGraphics.fillRect(obs.x * CELL + 2, obs.y * CELL + 2, CELL - 4, CELL - 4);
    }
    this.obstaclesGraphics.lineStyle(1, COLOR_HEX.muted, 0.5);
    for (const obs of this.obstacles) {
      this.obstaclesGraphics.strokeRect(obs.x * CELL + 2, obs.y * CELL + 2, CELL - 4, CELL - 4);
    }

    this.snakeGraphics.clear();
    for (let i = 0; i < this.snake.length; i++) {
      const segment = this.snake[i];
      const isHead = i === 0;
      const color = isHead ? COLOR_HEX.fg : COLOR_HEX.fg;
      const alpha = isHead ? 1 : 0.75 - Math.min(0.45, i * 0.012);
      this.snakeGraphics.fillStyle(color, alpha);
      this.snakeGraphics.fillRect(segment.x * CELL + 2, segment.y * CELL + 2, CELL - 4, CELL - 4);
    }

    this.foodGraphics.clear();
    if (this.food.x >= 0) {
      const golden = this.foodKind === "golden";
      const baseColor = golden ? COLOR_HEX.amber : COLOR_HEX.accent;
      const elapsed = time - this.foodSpawnedAt;
      const remaining = GOLDEN_TTL_MS - elapsed;

      let alpha = 1;
      if (golden && remaining < GOLDEN_BLINK_BELOW_MS) {
        const blinkPhase = (elapsed % 220) / 220;
        alpha = blinkPhase < 0.5 ? 1 : 0.25;
      }

      const pulse = Math.sin(time / 220) * 1.5 + (golden ? 4 : 2);
      const size = CELL - 6 - pulse;
      const offset = (CELL - size) / 2;
      this.foodGraphics.fillStyle(baseColor, alpha);
      this.foodGraphics.fillRect(this.food.x * CELL + offset, this.food.y * CELL + offset, size, size);
    }
  }

  // ---------- transições ----------

  private gameOver() {
    this.state = "gameover";
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.saveHighScore();
    }
    this.refreshStatus();
    playTone(180, 350, "sawtooth", 0.15);
    this.cameras.main.shake(220, 0.008);

    this.time.delayedCall(450, () => {
      this.overlayTitle.setText("FIM");
      const meta = this.rules.scoreTarget > 0 ? `  ·  meta ${this.rules.scoreTarget}` : "";
      this.overlaySubtitle.setText(`score ${this.score}${meta}  ·  high ${this.highScore}`);
      this.overlayHint.setText("R TENTAR DE NOVO  ·  ESC MENU");
      this.showOverlay();
    });
  }

  private phaseCleared() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.saveHighScore();
    }

    if (this.phase >= 5) {
      this.state = "campaigncomplete";
      this.saveCampaignPhase(5);
      playTone(660, 120, "triangle", 0.14);
      this.time.delayedCall(120, () => playTone(880, 150, "triangle", 0.14));
      this.time.delayedCall(280, () => playTone(1175, 220, "triangle", 0.14));
      this.overlayTitle.setText("CAMPANHA");
      this.overlaySubtitle.setText("você completou todas as 5 fases");
      this.overlayHint.setText("ESPAÇO VOLTAR AO MENU");
      this.showOverlay();
      return;
    }

    this.state = "phasecleared";
    this.saveCampaignPhase(Math.max(this.phase + 1, this.loadCampaignPhase()));
    playTone(660, 120, "triangle", 0.14);
    this.time.delayedCall(120, () => playTone(880, 180, "triangle", 0.14));

    this.time.delayedCall(350, () => {
      this.overlayTitle.setText(`FASE ${String(this.phase).padStart(2, "0")}`);
      this.overlaySubtitle.setText(`completou em ${this.score} pontos`);
      this.overlayHint.setText("ESPAÇO PRÓXIMA FASE  ·  ESC MENU");
      this.showOverlay();
    });
  }

  // ---------- persistência ----------

  private loadHighScore(): number {
    try {
      const raw = localStorage.getItem(highscoreKey(this.mode, this.mode === "classic" ? this.difficulty : undefined));
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private saveHighScore() {
    try {
      localStorage.setItem(
        highscoreKey(this.mode, this.mode === "classic" ? this.difficulty : undefined),
        String(this.highScore),
      );
    } catch {}
  }

  private loadCampaignPhase(): number {
    try {
      const raw = localStorage.getItem(CAMPAIGN_PHASE_KEY);
      const n = raw ? parseInt(raw, 10) : 1;
      return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
    } catch {
      return 1;
    }
  }

  private saveCampaignPhase(phase: number) {
    try {
      localStorage.setItem(CAMPAIGN_PHASE_KEY, String(Math.min(5, phase)));
    } catch {}
  }
}
