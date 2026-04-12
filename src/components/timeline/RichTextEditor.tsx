import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------
function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent the editor from losing focus on toolbar click
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`flex h-6 w-6 items-center justify-center rounded text-xs transition-colors
        ${active
          ? "bg-[var(--color-accent)] text-white"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]"
        }
        disabled:cursor-not-allowed disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-4 w-px bg-[var(--color-border)]" />;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit includes bold, italic, headings, bulletList, orderedList,
        // codeBlock, blockquote, horizontalRule, hard break, etc.
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown.getMarkdown() as string;
      onChange(md);
    },
  });

  // When switching tasks (value changes externally), reload editor content
  // without triggering onUpdate (to avoid a save loop)
  useEffect(() => {
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown.getMarkdown() as string;
    if (current !== value) {
      // setContent without emitting onUpdate to avoid a save loop
      editor.commands.setContent(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;

  // Link prompt helper
  function handleSetLink() {
    const prev = editor!.getAttributes("link").href ?? "";
    const url = window.prompt("URL", prev);
    if (url === null) return; // cancelled
    if (url === "") {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }

  return (
    <div className="flex flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] focus-within:border-[var(--color-accent)]">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-border)] px-1.5 py-1">

        {/* Headings */}
        <ToolbarButton
          title="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          title="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          title="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>

        <Divider />

        {/* Inline formatting */}
        <ToolbarButton
          title="Bold (Cmd+B)"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          title="Italic (Cmd+I)"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          title="Underline (Cmd+U)"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </ToolbarButton>

        <Divider />

        {/* Lists */}
        <ToolbarButton
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          {/* simple bullet list icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="1.5" cy="3" r="0.75" fill="currentColor" stroke="none" />
            <circle cx="1.5" cy="6" r="0.75" fill="currentColor" stroke="none" />
            <circle cx="1.5" cy="9" r="0.75" fill="currentColor" stroke="none" />
            <line x1="4" y1="3" x2="11" y2="3" />
            <line x1="4" y1="6" x2="11" y2="6" />
            <line x1="4" y1="9" x2="11" y2="9" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <text x="0" y="4" fontSize="4" fill="currentColor" stroke="none" fontFamily="monospace">1.</text>
            <text x="0" y="7.5" fontSize="4" fill="currentColor" stroke="none" fontFamily="monospace">2.</text>
            <text x="0" y="11" fontSize="4" fill="currentColor" stroke="none" fontFamily="monospace">3.</text>
            <line x1="5" y1="3" x2="11" y2="3" />
            <line x1="5" y1="6.5" x2="11" y2="6.5" />
            <line x1="5" y1="10" x2="11" y2="10" />
          </svg>
        </ToolbarButton>

        <Divider />

        {/* Code block */}
        <ToolbarButton
          title="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2L1 6l3 4M8 2l3 4-3 4" />
          </svg>
        </ToolbarButton>

        {/* Link */}
        <ToolbarButton
          title="Link"
          active={editor.isActive("link")}
          onClick={handleSetLink}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 7a3 3 0 004.24.01l1.5-1.5a3 3 0 00-4.24-4.24L5.5 2.26" />
            <path d="M7 5a3 3 0 00-4.24 0L1.26 6.5a3 3 0 004.24 4.24L6.5 9.74" />
          </svg>
        </ToolbarButton>
      </div>

      {/* ── Editor surface ───────────────────────────────────────────────── */}
      <EditorContent
        editor={editor}
        className="rich-editor min-h-[200px] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
      />
    </div>
  );
}
