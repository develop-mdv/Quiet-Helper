// Эвристическая детекция вопросов в реплике транскрипта (ru/en).
// Быстро и без затрат; для авто-ответа сверху может подключаться LLM-классификатор.

const RU_INTERROGATIVES = [
  'как', 'что', 'почему', 'зачем', 'когда', 'где', 'куда', 'откуда', 'кто', 'какой',
  'какая', 'какие', 'какое', 'сколько', 'чей', 'чем', 'чём', 'кого', 'кому', 'чему',
  'зачём', 'насколько', 'каков', 'какова', 'каковы'
]
// Глаголы-просьбы/побуждения — тоже считаем «вопросом к ассистенту».
const RU_IMPERATIVES = [
  'можешь', 'можете', 'сможешь', 'сможете', 'расскажи', 'расскажите', 'объясни',
  'объясните', 'напиши', 'напишите', 'реши', 'решите', 'дай', 'дайте', 'покажи',
  'покажите', 'подскажи', 'подскажите', 'помоги', 'помогите', 'посчитай', 'найди',
  'сформулируй', 'перечисли', 'опиши', 'сравни', 'докажи', 'выведи'
]
const EN_INTERROGATIVES = [
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'whom', 'whose', 'whats'
]
const EN_IMPERATIVES = [
  'can', 'could', 'would', 'should', 'do', 'does', 'did', 'is', 'are', 'was', 'were',
  'explain', 'write', 'describe', 'tell', 'give', 'implement', 'solve', 'show', 'list',
  'define', 'compare', 'prove', 'calculate', 'find'
]

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}

export function isQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.includes('?')) return true

  const ws = words(t)
  if (ws.length === 0) return false
  const first3 = ws.slice(0, 3)
  const set = new Set(ws)

  // Вопросительное слово в начале реплики.
  const interrog = [...RU_INTERROGATIVES, ...EN_INTERROGATIVES]
  if (first3.some((w) => interrog.includes(w))) return true

  // Вопросительное слово где угодно (Whisper часто теряет '?').
  if (ws.some((w) => interrog.includes(w))) return true

  // Частица «ли» — маркер вопроса («знаешь ли», «есть ли»).
  if (set.has('ли')) return true

  // Императив/просьба в начале — трактуем как задачу ассистенту.
  const imper = [...RU_IMPERATIVES, ...EN_IMPERATIVES]
  if (first3.some((w) => imper.includes(w))) return true

  return false
}

const DIRECT_MARKERS = [
  'как думаешь', 'что думаешь', 'твоё мнение', 'твое мнение', 'а ты', 'ты бы',
  'what do you think', 'your take', 'your opinion', 'how would you', 'what would you'
]

/** Грубая эвристика «вопрос адресован мне» (например «а ты как думаешь»). */
export function looksDirectedAtUser(text: string): boolean {
  const t = text.trim().toLowerCase()
  return DIRECT_MARKERS.some((m) => t.includes(m)) || isQuestion(text)
}
