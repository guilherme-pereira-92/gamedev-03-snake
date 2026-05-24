import Phaser from "phaser";
import { SnakeScene } from "./scenes/SnakeScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#0a0f1a",
  parent: "game",
  scene: SnakeScene,
});
