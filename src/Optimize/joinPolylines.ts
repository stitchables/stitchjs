import { Polyline } from '../Math/Polyline';

export function joinPolylines(
  polylines: Polyline[],
  maxJoinDistance: number,
): Polyline[] {
  let joinedPolylines = [polylines[0]];
  let queue = polylines.slice(1);
  while (true) {
    let [done, nextPolyline, queueIndex, minDistance, reverseFlag, frontAppendFlag] = [
      true,
      new Polyline(),
      0,
      Infinity,
      false,
      false,
    ];
    for (let [i, polyline] of queue.entries()) {
      let currentStart = joinedPolylines[joinedPolylines.length - 1].vertices[0];
      let currentEnd =
        joinedPolylines[joinedPolylines.length - 1].vertices[
          joinedPolylines[joinedPolylines.length - 1].vertices.length - 1
        ];
      let nextStart = polyline.vertices[0];
      let nextEnd = polyline.vertices[polyline.vertices.length - 1];
      if (currentStart && currentEnd && nextStart && nextEnd) {
        let [dcsns, dcsne, dcens, dcene] = [
          currentStart.distance(nextStart),
          currentStart.distance(nextEnd),
          currentEnd.distance(nextStart),
          currentEnd.distance(nextEnd),
        ];
        let d = Math.min(dcsns, dcsne, dcens, dcene);
        if (d < minDistance) {
          [nextPolyline, queueIndex, minDistance] = [polyline, i, d];
          reverseFlag = Math.min(dcsns, dcene) < Math.min(dcsne, dcens);
          frontAppendFlag = Math.min(dcsns, dcsne) < Math.min(dcens, dcene);
        }
        done = false;
      }
    }
    if (minDistance < maxJoinDistance) {
      if (reverseFlag) nextPolyline.vertices.reverse();
      if (frontAppendFlag) {
        for (let j = nextPolyline.vertices.length - 1; j >= 0; j--) {
          joinedPolylines[joinedPolylines.length - 1].addVertex(
            nextPolyline.vertices[j].x,
            nextPolyline.vertices[j].y,
            true,
          );
        }
      } else {
        for (let j = 0; j < nextPolyline.vertices.length; j++) {
          joinedPolylines[joinedPolylines.length - 1].addVertex(
            nextPolyline.vertices[j].x,
            nextPolyline.vertices[j].y,
            false,
          );
        }
      }
    } else if (!done) {
      if (reverseFlag) nextPolyline.vertices.reverse();
      if (frontAppendFlag) joinedPolylines.reverse();
      joinedPolylines.push(nextPolyline);
    }
    if (done) break;
    else queue.splice(queueIndex, 1);
  }
  return joinedPolylines;
}
