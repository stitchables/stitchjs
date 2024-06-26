export const Utils = {
  padLeft: function (string: string, length: number, char = ' '): string {
    return string.substring(0, length).padStart(length, char);
  },
  padRight: function (string: string, length: number, char = ' '): string {
    return string.substring(0, length).padEnd(length, char);
  },
  integerToBinary: function (value: number, bytes: number, endien = 'L'): Uint8Array {
    const byteArray = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) byteArray[i] = (value >> (i * 8)) & 0xff;
    if (endien === 'B') byteArray.reverse();
    else if (endien !== 'L')
      alert(`[Stitch.IO.Utils.integerToBinary] Unexpected endien value: ${endien}`);
    return byteArray;
  },
  saveData: function (data: (number | string | Uint8Array)[], filename: string): void {
    const blob = new Blob(data as BlobPart[], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
};
