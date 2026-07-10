import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'

/**
 * Приводит LaTeX-разделители, которые часто выдают модели (\[ \], \( \)),
 * к формату, понятному remark-math ($$ … $$ и $ … $), и оборачивает одиночный
 * \boxed{…} в инлайн-математику.
 */
function normalizeMath(input: string): string {
  let t = input
  // Парные \[ … \]  ->  блочная математика $$ … $$ (с обрезкой пробелов внутри)
  t = t.replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_m, inner: string) => `\n$$\n${inner}\n$$\n`)
  // Парные \( … \)  ->  инлайн $…$
  t = t.replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_m, inner: string) => `$${inner}$`)
  // Одиночный \boxed{…} вне $…$ -> обернуть в инлайн
  t = t.replace(/\\boxed\{([^{}]*)\}/g, (full, _inner: string, offset: number, str: string) => {
    const prev = str[offset - 1]
    const next = str[offset + full.length]
    if (prev === '$' || next === '$') return full
    return `$${full}$`
  })
  return t
}

/** Рендер Markdown-ответа: формулы (KaTeX), таблицы (GFM), подсветка кода. */
export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, errorColor: '#ff5c6c' }],
          rehypeHighlight
        ]}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}
