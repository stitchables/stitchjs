import { Browser } from './Browser';
import { Core } from './Core';
import { CSG } from './CSG';
import { Geometry } from './Geometry';
import { Graphics } from './Graphics';
import { IO } from './IO';
import { Math } from './Math';
import { Optimize } from './Optimize';
import * as str8 from '@matthewjacobson/str8';

// initialize wasm stuff here
export var isInitialized = false;
export async function init() {
  if (!isInitialized) {
    await str8.init();
    isInitialized = true;
  }
}

export { Browser, Core, CSG, Geometry, Graphics, IO, Math, Optimize };
