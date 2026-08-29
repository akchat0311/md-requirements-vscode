import Image from "@tiptap/extension-image";

/**
 * Image node for the webview (replaces the browser app's WorkspaceImage,
 * which resolved images through File System Access directory handles).
 *
 * Relative `src` attributes render against the document directory's
 * webview URI (host provides it in `init`; the directory is included in the
 * webview's localResourceRoots). Only rendering is mapped — the node attrs
 * keep the original relative path, so serialization stays byte-faithful.
 */

let base = "";

export function setImageBase(uri: string): void {
  base = uri.replace(/\/+$/, "");
}

const ABSOLUTE = /^(https?:|data:|vscode-webview:|file:|blob:)/i;

export function resolveImageSrc(src: string): string {
  if (!src || ABSOLUTE.test(src) || !base) return src;
  return `${base}/${src.replace(/^\.\//, "")}`;
}

export const WebviewImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      { ...HTMLAttributes, src: resolveImageSrc(String(HTMLAttributes.src ?? "")) },
    ];
  },
}).configure({ inline: false });
