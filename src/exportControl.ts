import { ICONS } from "./icons";
import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";

export interface ExportSource {
  createExportImage(): Promise<Blob>;
  getExportText(): string;
}

function timestampForFile(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Firefox may still be reading the object URL immediately after click().
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** ヘッダーに常時表示するローカル書き出しボタン。外部サービスとは通信しない。 */
export class ExportControl {
  private button: HTMLButtonElement;
  private anchor: HTMLElement;
  private popover: HTMLElement;
  private popoverFade: (show: boolean) => void;
  private open = false;
  private readonly closeRef = () => this.close();

  constructor(container: HTMLElement, getSource: () => ExportSource) {
    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "pill-btn settings-trigger export-trigger";
    this.button.setAttribute("aria-label", "殴り書きを書き出す");
    this.button.setAttribute("aria-haspopup", "menu");
    this.button.setAttribute("aria-expanded", "false");
    this.button.title = "書き出す";
    this.button.innerHTML = ICONS.export;
    this.button.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.button);

    this.popover = document.createElement("div");
    this.popover.className = "export-popover icon-popover icon-popover--below";
    this.popover.setAttribute("role", "menu");
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    const choices: Array<{ label: string; kind: "text" | "image" | "both" }> = [
      { label: "txtのみ", kind: "text" },
      { label: "画像のみ", kind: "image" },
      { label: "両方", kind: "both" },
    ];
    for (const choice of choices) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "export-option";
      item.setAttribute("role", "menuitem");
      item.textContent = choice.label;
      item.addEventListener("click", () => void this.runExport(choice.kind, getSource));
      this.popover.appendChild(item);
    }
    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);
  }

  private toggle(): void {
    if (this.open) this.close();
    else {
      notifyOpen(this.closeRef, this.anchor);
      this.open = true;
      this.button.dataset.active = "true";
      this.button.setAttribute("aria-expanded", "true");
      this.popoverFade(true);
    }
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.button.dataset.active = "false";
    this.button.setAttribute("aria-expanded", "false");
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  private async runExport(kind: "text" | "image" | "both", getSource: () => ExportSource): Promise<void> {
    this.close();
    this.button.disabled = true;
    try {
      const source = getSource();
      const stamp = timestampForFile(new Date());
      if (kind === "image" || kind === "both") {
        const image = await source.createExportImage();
        download(image, `ensou-${stamp}.png`);
      }
      if (kind === "text" || kind === "both") {
        const text = source.getExportText();
        download(new Blob([text], { type: "text/plain;charset=utf-8" }), `ensou-${stamp}.txt`);
      }
    } finally {
      this.button.disabled = false;
    }
  }
}
