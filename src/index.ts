import { Browser } from './Browser';
import { Core } from './Core';
import { CSG } from './CSG';
import { Geometry } from './Geometry';
import { Graphics } from './Graphics';
import { IO } from './IO';
import { Math } from './Math';
import { Optimize } from './Optimize';
import { SkeletonBuilder } from 'straight-skeleton';

// initialize wasm stuff here
export var isInitialized = false;
export async function init() {
  if (!isInitialized) {
    await SkeletonBuilder.init();
    isInitialized = true;
  }
}

export { Browser, Core, CSG, Geometry, Graphics, IO, Math, Optimize };
