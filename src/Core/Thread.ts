import { IRun } from '../Runs/IRun';

export class Thread {
  red: number;
  green: number;
  blue: number;
  runs: IRun[];
  constructor(red: number, green: number, blue: number) {
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.runs = [];
  }
  addRun(run: IRun): void {
    this.runs.push(run);
  }
}
