import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { usePrompt, type Prompt } from "@/context/prompt"
import { setCursorPosition } from "@/components/prompt-input/editor-dom"

type SelectionState = {
  text: string
  rect: DOMRect
}

function promptTextLength(prompt: Prompt) {
  return prompt.reduce((len, part) => len + ("content" in part ? part.content.length : 0), 0)
}

function withOffsets(prompt: Prompt): Prompt {
  let offset = 0
  return prompt.map((part) => {
    if (part.type === "image") return part
    const next = { ...part, start: offset, end: offset + part.content.length }
    offset = next.end
    return next
  })
}

function insertText(prompt: Prompt, cursor: number, content: string): Prompt {
  let position = 0
  let inserted = false
  const parts = prompt.flatMap<Prompt[number]>((part) => {
    if (part.type === "image") return [part]
    const start = position
    position += part.content.length
    if (inserted) return [part]
    if (part.type === "text" && cursor >= start && cursor <= position) {
      inserted = true
      const offset = cursor - start
      return [{ ...part, content: part.content.slice(0, offset) + content + part.content.slice(offset) }]
    }
    if (cursor > start) return [part]
    inserted = true
    return [{ type: "text", content, start: 0, end: 0 } as Prompt[number], part]
  })
  if (!inserted) parts.push({ type: "text", content, start: 0, end: 0 } as Prompt[number])
  return withOffsets(parts)
}

function formatQuoted(text: string) {
  const normalized = text.replace(/\r\n/g, "\n")
  let lines = normalized.split("\n")
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  if (lines.length === 0) return ""
  const quoted = lines.map((line) => (line.trim() === "" ? ">" : `> ${line}`)).join("\n")
  return quoted
}

function focusEditorAt(cursor: number) {
  const editor = document.querySelector<HTMLElement>('[data-component="prompt-input"]')
  if (!editor) return
  editor.focus()
  requestAnimationFrame(() => {
    try {
      setCursorPosition(editor, cursor)
    } catch {
      const range = document.createRange()
      const selection = window.getSelection()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    editor.scrollIntoView({ block: "nearest" })
  })
}

export function SelectionQuote() {
  const prompt = usePrompt()
  const language = useLanguage()
  const [state, setState] = createSignal<SelectionState | null>(null)
  let raf: number | undefined

  const update = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setState(null)
      return
    }
    const text = selection.toString()
    if (!text.trim() || text.trim().length < 2) {
      setState(null)
      return
    }
    const range = selection.getRangeAt(0)
    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    const common = range.commonAncestorContainer
    const promptInput = document.querySelector('[data-component="prompt-input"]')
    const containsPrompt =
      (promptInput && anchorNode && promptInput.contains(anchorNode)) ||
      (promptInput && focusNode && promptInput.contains(focusNode)) ||
      (promptInput && common instanceof Node && promptInput.contains(common))
    if (containsPrompt) {
      setState(null)
      return
    }
    const isInside = (node: Node | null) => {
      if (!node) return false
      const el = node instanceof Element ? node : node.parentElement
      if (!el) return false
      if (el.closest('[data-component="selection-quote"]')) return true
      if (el.closest('input, textarea, select, button, [role="dialog"], [data-component="dialog-v2"], [data-slot="popover"], [data-component="dropdown-menu-content"]')) return true
      return false
    }
    if (isInside(anchorNode) || isInside(focusNode) || isInside(common instanceof Element ? common : common.parentElement)) {
      setState(null)
      return
    }
    const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
    const focusEl = focusNode instanceof Element ? focusNode : focusNode?.parentElement
    if (anchorEl?.closest('[data-component="sidebar-rail"]') || focusEl?.closest('[data-component="sidebar-rail"]')) {
      setState(null)
      return
    }
    const rects = range.getClientRects()
    const first = rects[0] ?? range.getBoundingClientRect()
    if (!first || (first.width === 0 && first.height === 0)) {
      setState(null)
      return
    }
    if (first.bottom < 0 || first.top > window.innerHeight || first.right < 0 || first.left > window.innerWidth) {
      setState(null)
      return
    }
    setState({ text, rect: first })
  }

  const scheduleUpdate = () => {
    if (raf !== undefined) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(update)
  }

  const handleSelectionChange = () => scheduleUpdate()
  const handleMouseUp = () => scheduleUpdate()
  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift") scheduleUpdate()
  }
  const handleScroll = () => setState(null)
  const handleResize = () => setState(null)

  onMount(() => {
    document.addEventListener("selectionchange", handleSelectionChange)
    document.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("keyup", handleKeyUp)
    document.addEventListener("scroll", handleScroll, true)
    window.addEventListener("resize", handleResize)
    window.addEventListener("scroll", handleScroll, true)
  })

  onCleanup(() => {
    document.removeEventListener("selectionchange", handleSelectionChange)
    document.removeEventListener("mouseup", handleMouseUp)
    document.removeEventListener("keyup", handleKeyUp)
    document.removeEventListener("scroll", handleScroll, true)
    window.removeEventListener("resize", handleResize)
    window.removeEventListener("scroll", handleScroll, true)
    if (raf !== undefined) cancelAnimationFrame(raf)
  })

  const position = createMemo(() => {
    const current = state()
    if (!current) return { top: 0, left: 0 }
    const { rect } = current
    const buttonHeight = 24
    const gap = 6
    let top = rect.top - buttonHeight - gap
    let left = rect.left
    if (top < 8) top = rect.bottom + gap
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth
    const estimatedWidth = 90
    if (left + estimatedWidth > viewportWidth - 8) left = viewportWidth - estimatedWidth - 8
    if (left < 8) left = 8
    return { top, left }
  })

  const onQuote = () => {
    const current = state()
    if (!current) return
    const raw = current.text
    const quoted = formatQuoted(raw)
    if (!quoted) return
    const curPrompt = prompt.current()
    const cursor = prompt.cursor() ?? promptTextLength(curPrompt)
    const existingText = curPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const needsPrefix = existingText.length > 0 && !existingText.endsWith("\n")
    const insertion = `${needsPrefix ? "\n" : ""}${quoted}\n\n`
    const nextPrompt = insertText(curPrompt, cursor, insertion)
    const nextCursor = cursor + insertion.length
    prompt.set(nextPrompt, nextCursor)
    setState(null)
    window.getSelection()?.removeAllRanges()
    focusEditorAt(nextCursor)
  }

  return (
    <Portal>
      <Show when={state()}>
        <div
          data-component="selection-quote"
          style={{
            position: "fixed",
            top: `${position().top}px`,
            left: `${position().left}px`,
            "z-index": "9999",
            display: "flex",
          }}
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
        >
          <ButtonV2
            size="small"
            variant="neutral"
            icon="quote"
            onMouseDown={(event: MouseEvent) => event.preventDefault()}
            onClick={onQuote}
            style={{
              cursor: "default",
              "box-shadow": "var(--v2-elevation-floating, 0 4px 12px rgba(0,0,0,0.12)), var(--v2-elevation-raised)",
              "border": "1px solid var(--v2-border-border-base)",
              "backdrop-filter": "blur(6px)",
            }}
            aria-label={language.t("prompt.action.quote")}
          >
            {language.t("prompt.action.quote")}
          </ButtonV2>
        </div>
      </Show>
    </Portal>
  )
}
