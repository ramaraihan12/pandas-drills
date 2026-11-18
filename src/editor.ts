import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

export interface Editor {
  getCode(): string;
  setCode(code: string): void;
  focus(): void;
}

export function createEditor(
  parent: HTMLElement,
  opts: { doc: string; onChange: (code: string) => void; onRun: () => void; onCheck: () => void },
): Editor {
  const theme = new Compartment();
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const themeFor = (isDark: boolean) =>
    isDark
      ? oneDark
      : EditorView.theme({ "&": { backgroundColor: "var(--editor-bg)" }, ".cm-gutters": { backgroundColor: "var(--editor-gutter)", border: "none" } });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        basicSetup,
        python(),
        theme.of(themeFor(dark.matches)),
        keymap.of([
          { key: "Mod-Enter", run: () => (opts.onRun(), true) },
          { key: "Mod-Shift-Enter", run: () => (opts.onCheck(), true) },
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Python code editor" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  dark.addEventListener("change", (e) => view.dispatch({ effects: theme.reconfigure(themeFor(e.matches)) }));

  return {
    getCode: () => view.state.doc.toString(),
    setCode: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    focus: () => view.focus(),
  };
}
