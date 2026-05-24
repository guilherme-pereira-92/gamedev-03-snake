import Phaser from "phaser";

const COLS = 40;
const ROWS = 30;
const CELL = 20;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const TICK_MS = 110;
const SCORE_PER_FOOD = 10;
const HIGHSCORE_KEY = "snake-highscore";

type Cell = { x: number; y: number };
type Direction = { x: number; y: number };
type State = "start" | "playing" | "paused" | "gameover";

const DIR_UP: Direction = { x: 0, y: -1 };
const DIR_DOWN: Direction = { x: 0, y: 1 };
const DIR_LEFT: Direction = { x: -1, y: 0 };
const DIR_RIGHT: Direction = { x: 1, y: 0 };

export class SnakeScene extends Phaser.Scene {
  private snake: Cell[] = [];
  private food: Cell = { x: -1, y: -1 };
  private currentDirection: Direction = DIR_RIGHT;
  private nextDirection: Direction = DIR_RIGHT;
  private tickAccumulator = 0;
  private score = 0;
  private highScore = 0;
  private state: State = "start";

  private snakeGraphics!: Phaser.GameObjects.Graphics;
  private foodGraphics!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlaySubtitle!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private keys!: {
    UP: Phaser.Input.Keyboard.Key;
    DOWN: Phaser.Input.Keyboard.Key;
    LEFT: Phaser.Input.Keyboard.Key;
    RIGHT: Phaser.Input.Keyboard.Key;
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
    R: Phaser.Input.Keyboard.Key;
    P: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super("snake");
  }

  create() {
    this.highScore = this.loadHighScore();

    this.drawGridBackground();

    this.snakeGraphics = this.add.graphics();
    this.foodGraphics = this.add.graphics();

    this.scoreText = this.add.text(12, 8, "", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#94a3b8",
    });

    this.overlayBg = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.72);
    this.overlayTitle = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 90, "", {
        fontFamily: "monospace",
        fontSize: "84px",
        color: "#22c55e",
      })
      .setOrigin(0.5);
    this.overlaySubtitle = this.add
      .text(WIDTH / 2, HEIGHT / 2 + 5, "", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#e2e8f0",
      })
      .setOrigin(0.5);
    this.overlayHint = this.add
      .text(WIDTH / 2, HEIGHT / 2 + 70, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);

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
    };

    this.updateScoreText();
    this.showStartScreen();
  }

  update(_time: number, delta: number) {
    this.handleInput();

    if (this.state === "playing") {
      this.tickAccumulator += delta;
      while (this.tickAccumulator >= TICK_MS) {
        this.tickAccumulator -= TICK_MS;
        this.step();
        if (this.state !== "playing") break;
      }
      this.draw();
    }
  }

  private handleInput() {
    const justDown = Phaser.Input.Keyboard.JustDown;

    if (justDown(this.keys.UP) || justDown(this.keys.W)) this.tryTurn(DIR_UP);
    else if (justDown(this.keys.DOWN) || justDown(this.keys.S)) this.tryTurn(DIR_DOWN);
    else if (justDown(this.keys.LEFT) || justDown(this.keys.A)) this.tryTurn(DIR_LEFT);
    else if (justDown(this.keys.RIGHT) || justDown(this.keys.D)) this.tryTurn(DIR_RIGHT);

    if (this.state === "start" && justDown(this.keys.SPACE)) {
      this.startGame();
    } else if (this.state === "playing" && justDown(this.keys.P)) {
      this.state = "paused";
      this.showPauseScreen();
    } else if (this.state === "paused" && justDown(this.keys.P)) {
      this.state = "playing";
      this.hideOverlay();
    } else if (this.state === "gameover" && justDown(this.keys.R)) {
      this.startGame();
    }
  }

  private tryTurn(dir: Direction) {
    if (dir.x === -this.currentDirection.x && dir.y === -this.currentDirection.y) return;
    this.nextDirection = dir;
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
    this.tickAccumulator = 0;
    this.spawnFood();
    this.state = "playing";
    this.hideOverlay();
    this.updateScoreText();
    this.draw();
  }

  private step() {
    this.currentDirection = this.nextDirection;

    const head = this.snake[0];
    const newHead: Cell = {
      x: head.x + this.currentDirection.x,
      y: head.y + this.currentDirection.y,
    };

    if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
      this.gameOver();
      return;
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
      this.score += SCORE_PER_FOOD;
      this.updateScoreText();
      this.spawnFood();
    } else {
      this.snake.pop();
    }
  }

  private spawnFood() {
    const occupied = new Set(this.snake.map((c) => `${c.x},${c.y}`));
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
  }

  private draw() {
    this.snakeGraphics.clear();
    for (let i = 0; i < this.snake.length; i++) {
      const segment = this.snake[i];
      const color = i === 0 ? 0x4ade80 : 0x22c55e;
      this.snakeGraphics.fillStyle(color);
      this.snakeGraphics.fillRect(
        segment.x * CELL + 1,
        segment.y * CELL + 1,
        CELL - 2,
        CELL - 2,
      );
    }

    this.foodGraphics.clear();
    if (this.food.x >= 0) {
      this.foodGraphics.fillStyle(0xef4444);
      this.foodGraphics.fillRect(
        this.food.x * CELL + 3,
        this.food.y * CELL + 3,
        CELL - 6,
        CELL - 6,
      );
    }
  }

  private drawGridBackground() {
    const g = this.add.graphics();
    g.lineStyle(1, 0x1e293b, 0.5);
    for (let i = 1; i < COLS; i++) {
      g.lineBetween(i * CELL, 0, i * CELL, HEIGHT);
    }
    for (let j = 1; j < ROWS; j++) {
      g.lineBetween(0, j * CELL, WIDTH, j * CELL);
    }
  }

  private updateScoreText() {
    const high = Math.max(this.score, this.highScore);
    this.scoreText.setText(`SCORE: ${this.score}    HIGH: ${high}`);
  }

  private gameOver() {
    this.state = "gameover";
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.saveHighScore();
    }
    this.updateScoreText();
    this.showGameOverScreen();
  }

  private loadHighScore(): number {
    try {
      const raw = localStorage.getItem(HIGHSCORE_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private saveHighScore() {
    try {
      localStorage.setItem(HIGHSCORE_KEY, String(this.highScore));
    } catch {
      // localStorage indisponível (modo privado, cota cheia) — ignora silenciosamente
    }
  }

  private showStartScreen() {
    this.overlayBg.setVisible(true);
    this.overlayTitle.setVisible(true).setText("SNAKE").setColor("#22c55e");
    this.overlaySubtitle.setVisible(true).setText(`HIGH SCORE: ${this.highScore}`);
    this.overlayHint
      .setVisible(true)
      .setText("ESPAÇO para jogar    setas ou WASD para mover    P para pausar");
  }

  private showPauseScreen() {
    this.overlayBg.setVisible(true);
    this.overlayTitle.setVisible(true).setText("PAUSADO").setColor("#fbbf24");
    this.overlaySubtitle.setVisible(true).setText("");
    this.overlayHint.setVisible(true).setText("P para continuar");
  }

  private showGameOverScreen() {
    this.overlayBg.setVisible(true);
    this.overlayTitle.setVisible(true).setText("GAME OVER").setColor("#ef4444");
    const isNewRecord = this.score > 0 && this.score >= this.highScore;
    const subtitle = isNewRecord
      ? `NOVO RECORDE: ${this.score}`
      : `Score ${this.score}    •    High ${this.highScore}`;
    this.overlaySubtitle.setVisible(true).setText(subtitle).setColor(isNewRecord ? "#fbbf24" : "#e2e8f0");
    this.overlayHint.setVisible(true).setText("R para jogar novamente");
  }

  private hideOverlay() {
    this.overlayBg.setVisible(false);
    this.overlayTitle.setVisible(false);
    this.overlaySubtitle.setVisible(false);
    this.overlayHint.setVisible(false);
  }
}
