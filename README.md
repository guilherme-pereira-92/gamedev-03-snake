# 03 — Snake

Snake clássico em grid 40×30. High score persistente entre sessões. Pausa, restart, tudo num overlay limpo.

**Controles:**
- Iniciar: `ESPAÇO`
- Mover: setas ou `WASD`
- Pausar: `P`
- Jogar de novo (game over): `R`

**Stack:** TypeScript + Phaser 3 + Vite.

## Rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:5175`.

## Conceitos novos (vs Pong)

### 1. Fixed timestep — o game loop "tick-based"

Pong se mexia **todo frame** (60 vezes por segundo). Snake é diferente: a cobra anda **uma célula por tick**, com tick fixo em **110 ms**.

```ts
update(_time, delta) {
  this.tickAccumulator += delta;
  while (this.tickAccumulator >= TICK_MS) {
    this.tickAccumulator -= TICK_MS;
    this.step();
  }
}
```

Isso é o padrão **fixed timestep with accumulator** (Glenn Fiedler, "Fix Your Timestep!" — leitura clássica de game dev). O que ele garante:

- A lógica do jogo só roda em **passos fixos e previsíveis**. Comportamento idêntico em 60fps, 144fps ou 30fps.
- O `while` (não `if`) é importante: se um frame demorou 250ms (você tirou foco da aba), o acumulador acumula `> 2 × TICK_MS` e o loop **atualiza múltiplas vezes** pra "alcançar". O jogo "engasga" visualmente mas mantém timing correto.
- A renderização continua a 60fps (chamada fora do `while`).

**Por que isso é central:** muitos bugs de física, multiplayer e replay (gravar e tocar de volta) só funcionam se a lógica for fixed timestep. Pong "manualmente delta" era OK pra um jogo simples, mas qualquer coisa mais séria → fixed timestep.

### 2. Mundo em grid (vs pixel)

A cobra não existe em pixels — existe em **células**:

```ts
type Cell = { x: number; y: number };  // x ∈ [0, COLS), y ∈ [0, ROWS)
const COLS = 40, ROWS = 30, CELL = 20;
```

A conversão pra pixels só acontece no `draw()`:

```ts
this.snakeGraphics.fillRect(segment.x * CELL + 1, segment.y * CELL + 1, CELL - 2, CELL - 2);
```

**Por que separar?** Porque a lógica de jogo (colisão, movimento, comida) é trivial em coordenadas inteiras — comparar `head.x === food.x && head.y === food.y` em vez de `Math.abs(head.x - food.x) < CELL/2 && ...`. **Sempre que seu jogo é discreto (xadrez, tetris, puzzles, RPG tile-based), pense em grid.**

### 3. A cobra é um array — head/tail mechanics

```ts
private snake: Cell[] = [...];  // [head, ..., tail]

step() {
  this.snake.unshift(newHead);  // adiciona cabeça
  if (willEat) {
    spawnFood();                // não tira o rabo → cresce
  } else {
    this.snake.pop();           // tira o rabo → mesmo tamanho
  }
}
```

Esse é o **truque clássico de Snake**: você não move cada segmento. Só adiciona um na frente e tira um atrás. Mover só o necessário.

**Custo:** `unshift` em array JavaScript é O(n) (move todos os elementos). Pra Snake com 1000 segmentos, ainda é instantâneo. Em jogos onde isso virasse gargalo, usaria estrutura de fila com índices circulares (O(1)).

### 4. Anti-reversal — não pode dar a ré

Se você tá indo pra direita e aperta esquerda, **o jogo deve ignorar**. Senão a cobra vira instantaneamente pro próprio corpo e morre.

```ts
private tryTurn(dir: Direction) {
  if (dir.x === -this.currentDirection.x && dir.y === -this.currentDirection.y) return;
  this.nextDirection = dir;
}
```

Vetores opostos: `(1,0)` e `(-1,0)`, ou `(0,1)` e `(0,-1)`. Se o novo é o negado do atual, ignora.

### 5. `currentDirection` vs `nextDirection` — input buffering

```ts
private currentDirection: Direction = DIR_RIGHT;
private nextDirection: Direction = DIR_RIGHT;
```

Input atualiza `nextDirection` imediatamente, mas o `step()` só aplica `currentDirection = nextDirection` no **próximo tick**. Por quê?

Cenário: tick a cada 110ms. Cobra indo pra direita. Você aperta `↑` no ms 50, depois `←` no ms 80, ambos antes do próximo tick (ms 110). Se eu aplicasse imediatamente:
- ms 50: dir = up
- ms 80: dir = left  
- ms 110: cobra anda pra esquerda (cancelou o "up")

Com o buffer de "nextDirection", aplica-se sempre o último input antes do tick. Comportamento intuitivo.

**Variação:** uma fila de direções (em vez de slot único). Você consome uma por tick. Permite "dobras rápidas" tipo `up → left → down` em sequência sem perder uma. Mais complexo. Esse é um desafio pra você embaixo.

### 6. Spawn validation — comida fora do corpo

```ts
const occupied = new Set(this.snake.map(c => `${c.x},${c.y}`));
let candidate;
do {
  candidate = randomCell();
} while (occupied.has(`${candidate.x},${candidate.y}`));
```

Sem isso, eventualmente a comida nasce **em cima da cobra** e fica inalcançável.

**Performance:** rejection sampling fica lento quando a cobra ocupa quase todo o tabuleiro (você sorteia muitas vezes até cair numa célula livre). Pra board pequeno ou caso limite, **enumere as células livres e sorteie uma**. Pra Snake casual, rejection sampling tá ótimo.

### 7. `localStorage` para persistir entre sessões

```ts
private loadHighScore(): number {
  try {
    const raw = localStorage.getItem(HIGHSCORE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
```

`localStorage` é **string-only**, **síncrono**, **por origem** (cada site/porta tem seu próprio), e **pode falhar** (modo privado, cota cheia, usuário desabilitou). Por isso o `try/catch` em torno do `.getItem` e `.setItem` — game crashar porque não conseguiu salvar high score seria ridículo.

Pra dados maiores (saves de RPG, replays), use `IndexedDB` (assíncrono, suporta blobs). Pra config simples e high scores, `localStorage` é perfeito.

### 8. `Graphics` em vez de um Rectangle por célula

Tentação: criar `Phaser.GameObjects.Rectangle` pra cada segmento da cobra. Problema: a cobra cresce/diminui a cada tick — você ficaria criando e destruindo objetos toda hora. Caro em alocação, GC, batch de render.

Solução idiomática Phaser: **um único `Graphics`**. Em cada draw:

```ts
this.snakeGraphics.clear();
for (segment of this.snake) {
  this.snakeGraphics.fillStyle(color);
  this.snakeGraphics.fillRect(...);
}
```

Graphics acumula um buffer de "comandos de desenho" e renderiza tudo de uma vez. **Muito mais barato** que múltiplos GameObjects pra shapes que mudam todo frame.

Regra geral em Phaser:
- **GameObjects** (Rectangle, Sprite, etc.) → coisas com identidade própria, animações independentes, física, eventos. Estáveis no tempo.
- **Graphics** → desenho vetorial que muda muito ou tem muitas partes. Sem identidade individual.

### 9. Overlay UI sobre o jogo

```ts
this.overlayBg = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.72);
this.overlayTitle = this.add.text(...);
// .setVisible(true/false) pra mostrar/esconder
```

O overlay é só um retângulo preto semi-transparente + textos por cima. Mostro/escondo via `.setVisible()`. **Não recrio** os GameObjects toda vez — alterno visibilidade. Padrão simples, eficiente.

Em jogos maiores, um overlay é uma `Scene` paralela (rodando junto da game scene) — gerencia melhor o input (a scene de baixo pausa enquanto a de cima está ativa). Faremos isso lá no #07 (RPG).

## Conceitos consolidados

| Conceito | Aplicação |
|----------|-----------|
| Fixed timestep + accumulator | `tickAccumulator += delta; while (...)` |
| Coordenadas em grid | `Cell { x, y }` → pixel só no draw |
| Snake como array (unshift/pop) | Crescimento eficiente |
| Anti-reversal direction | `(1,0)` vs `(-1,0)` check |
| Input buffering (slot único) | `nextDirection` aplicada no tick |
| Spawn validation com `Set` | Comida nunca em cima do corpo |
| `localStorage` defensivo | `try/catch` em torno de tudo |
| `Graphics` para shapes dinâmicas | Um draw call em vez de N objetos |
| Overlay UI por visibilidade | `setVisible(true/false)` |

## Desafios para evoluir

1. **Aceleração com tamanho**: `TICK_MS` diminui (cobra acelera) a cada N pontos. Vai ficando insano.
2. **Fila de direções** (não slot único): permite dobras rápidas tipo `↑→↓` em sequência.
3. **Modos de tabuleiro**: opção no menu — bordas matam (atual) vs bordas teleportam (sai à direita, entra à esquerda).
4. **Comida especial**: a cada 5 comidas normais, spawn de comida dourada (vale 50, expira em 4 segundos com piscadinha).
5. **Obstáculos**: gerar 5 "paredes" aleatórias no tabuleiro a cada partida.
6. **Áudio**: bip ao comer, som diferente ao bater.
7. **Tela cheia**: botão pra entrar em fullscreen (`this.scale.startFullscreen()`).

## Próximo

[04 — Breakout](../04-breakout/) (a criar): vamos finalmente usar **física Arcade** do Phaser (em vez de manual), múltiplos tipos de objeto (paddle, bola, **muitos blocos**), dados de fase em JSON, power-ups, e o primeiro **asset visual** (uma imagem pra bola/blocos, vai introduzir `preload`).
