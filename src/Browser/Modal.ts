import { Pattern } from '../Core/Pattern';
import { write } from '../IO/write';
import { Math } from '../Math';
import { Select } from './Select';
import { Utils } from './Utils';

export class Modal {
  container: HTMLDivElement;
  constructor(content: HTMLDivElement) {
    this.container = this.createContainer();
    this.container.appendChild(content);
  }
  createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.style.display = 'none';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    container.style.zIndex = '1000';
    return container;
  }
  open(): void {
    this.container.style.display = 'block';
  }
  close(): void {
    this.container.style.display = 'none';
  }
  static createDownloadModal(
    pattern: Pattern,
    filename: string,
    minOutputWidthMm: number,
    maxOutputWidthMm: number,
  ): Modal {
    const modalContent = Utils.createElement('div', {
      position: 'absolute',
      inset: '50%',
      transform: 'translate(-50%, -50%)',
      width: '50%',
      'min-width': '100px',
      'min-height': '100px',
      height: '50%',
      'background-color': 'white',
      'border-radius': '10px',
      display: 'flex',
      'flex-grow': '1',
      'flex-direction': 'column',
      'justify-content': 'center',
      'align-items': 'center',
    });

    modalContent.appendChild(
      Utils.createElement(
        'div',
        {
          'font-size': '16px',
          'font-weight': 'bold',
          padding: '7px',
        },
        {},
        { innerHTML: 'File Format' },
      ),
    );

    const fileFormatSelect = new Select(['PES', 'DST']);
    Utils.setStyles(fileFormatSelect.container, {
      width: '80%',
      'text-align-last': 'center',
    });
    Utils.setStyles(fileFormatSelect.select, {
      width: '80%',
      'text-align-last': 'center',
    });
    modalContent.appendChild(fileFormatSelect.container);

    modalContent.appendChild(
      Utils.createElement('hr', {
        width: '90%',
        margin: '15px',
      }),
    );

    modalContent.appendChild(
      Utils.createElement(
        'div',
        {
          'font-size': '16px',
          'font-weight': 'bold',
        },
        {},
        { innerHTML: 'Dimensions' },
      ),
    );

    const dimensionsSlider = Utils.createElement(
      'input',
      { width: '80%' },
      {
        type: 'range',
        min: minOutputWidthMm.toString(),
        max: maxOutputWidthMm.toString(),
        value: (0.5 * (minOutputWidthMm + maxOutputWidthMm)).toString(),
      },
    ) as HTMLInputElement;
    modalContent.appendChild(dimensionsSlider);

    const dimensionsDisplay = Utils.createElement('div', {
      width: '100%',
      display: 'flex',
      'justify-content': 'space-evenly',
    });
    modalContent.appendChild(dimensionsDisplay);

    const widthDisplay = Utils.createElement('div', {});
    const heightDisplay = Utils.createElement('div', {});
    dimensionsDisplay.appendChild(widthDisplay);
    dimensionsDisplay.appendChild(heightDisplay);

    function calculateDimensions() {
      const w = Number.parseInt(dimensionsSlider.value);
      const h = (w * pattern.heightPx) / pattern.widthPx;
      widthDisplay.innerHTML = `Width: ${Math.Utils.mmToIn(w).toPrecision(
        3,
      )} in / ${w.toPrecision(3)} mm`;
      heightDisplay.innerHTML = `Height: ${Math.Utils.mmToIn(h).toPrecision(
        3,
      )} in / ${h.toPrecision(3)} mm`;
    }
    calculateDimensions();

    modalContent.appendChild(
      Utils.createElement('hr', {
        width: '90%',
        margin: '15px',
      }),
    );

    const downloadButton = Utils.createElement(
      'button',
      {
        'font-size': '16px',
        'font-weight': 'bold',
      },
      {},
      { innerHTML: 'Download' },
    );
    modalContent.appendChild(downloadButton);

    const downloadModal = new Modal(modalContent as HTMLDivElement);

    dimensionsSlider.addEventListener('input', calculateDimensions);

    downloadButton.addEventListener('click', () => {
      const test = dimensionsSlider as HTMLInputElement;
      write(
        pattern,
        Number.parseInt(test.value),
        (Number.parseInt(test.value) * pattern.heightPx) / pattern.widthPx,
        `${filename}.${fileFormatSelect.getValue()}`,
      );
      downloadModal.close();
    });

    return downloadModal;
  }
}
