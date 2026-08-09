/**
 * A small expression language for workflow conditions.
 *
 * Steps need to ask questions about what came back — "is the job finished?",
 * "did we get a 2xx?", "is the status one of the terminal ones?" — and plain
 * truthiness cannot express any of them. This evaluates expressions like
 *
 *     {{status}} == "completed"
 *     {{status}} in ["completed", "failed", "cancelled"]
 *     {{this.status}} >= 200 and {{this.status}} < 300
 *     {{body}} contains "ready" or not {{pending}}
 *
 * against the run context.
 *
 * It is a real parser rather than a regex or `eval`. `eval` would hand a
 * workflow file the ability to run arbitrary code in the main process, and a
 * regex cannot handle grouping or precedence. Everything here is total: it
 * either returns a boolean or throws a message worth showing to the user.
 *
 * A bare operand with no operator falls back to truthiness, so conditions
 * written before this existed keep working unchanged.
 */

/** Values that can appear while evaluating. Context values are always strings. */
type Value = string | string[];

type Token =
  | { kind: 'var'; name: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'word'; value: string }
  | { kind: 'end' };

const OPERATORS = ['==', '!=', '>=', '<=', '>', '<'];
const WORD_OPERATORS = ['contains', 'matches', 'in'];

/** Values treated as false. Matches what the workflow guard has always used. */
const FALSY = new Set(['', 'false', '0', 'null', 'undefined', 'nan']);

export function isTruthy(value: Value): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return !FALSY.has(value.trim().toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // {{name}} — the same placeholder syntax used everywhere else.
    if (ch === '{' && source[i + 1] === '{') {
      const close = source.indexOf('}}', i + 2);
      if (close === -1) throw new Error('Unclosed {{ in condition.');
      const name = source.slice(i + 2, close).trim();
      // Names may be paths — `response.data.demo.status`, `response.items[0].id`
      // — so brackets and quoted keys are part of a valid name here.
      if (!/^[\w.\-[\]"'$]+$/.test(name)) {
        throw new Error(`"${name}" is not a valid variable name.`);
      }
      tokens.push({ kind: 'var', name });
      i = close + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let out = '';
      i += 1;
      while (i < source.length && source[i] !== ch) {
        // Backslash escapes the quote character and itself, nothing else —
        // these are literals, not a string format.
        if (source[i] === '\\' && (source[i + 1] === ch || source[i + 1] === '\\')) {
          out += source[i + 1];
          i += 2;
        } else {
          out += source[i];
          i += 1;
        }
      }
      if (i >= source.length) throw new Error('Unclosed quote in condition.');
      i += 1;
      tokens.push({ kind: 'string', value: out });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let out = '';
      if (ch === '-') {
        out = '-';
        i += 1;
      }
      while (i < source.length && /[0-9.]/.test(source[i]!)) {
        out += source[i];
        i += 1;
      }
      tokens.push({ kind: 'number', value: out });
      continue;
    }

    const twoChar = source.slice(i, i + 2);
    if (OPERATORS.includes(twoChar)) {
      tokens.push({ kind: 'op', value: twoChar });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(ch) || '()[],'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let out = '';
      while (i < source.length && /[\w-]/.test(source[i]!)) {
        out += source[i];
        i += 1;
      }
      tokens.push({ kind: 'word', value: out });
      continue;
    }

    throw new Error(`Unexpected character "${ch}" in condition.`);
  }

  tokens.push({ kind: 'end' });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Parser and evaluator                                                */
/* ------------------------------------------------------------------ */

/**
 * Parsing and evaluation happen together. Conditions are tiny and evaluated
 * once per attempt, so building a separate AST would buy nothing.
 *
 * Both sides of `and`/`or` are always evaluated rather than short-circuited.
 * That costs nothing here and means a typo'd variable on the right of an `or`
 * is still reported instead of hiding behind a true left side.
 */
class Evaluator {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: Record<string, string>,
    private readonly unknown: Set<string>,
    /** Consulted for names the context does not hold, e.g. response paths. */
    private readonly resolve?: (name: string) => string | undefined,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  private isWord(word: string): boolean {
    const token = this.peek();
    return token.kind === 'word' && token.value.toLowerCase() === word;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === 'op' && token.value === value;
  }

  evaluate(): boolean {
    const result = this.or();
    if (this.peek().kind !== 'end') {
      // Say what to do, not just what went wrong. Nearly every case of this is
      // a value that needs quoting.
      throw new Error(
        `Unexpected ${describe(this.peek())} after a complete condition. ` +
          'If it is part of a text value, put the value in quotes — ' +
          'for example {{status}} == "Access Token".',
      );
    }
    return result;
  }

  private or(): boolean {
    let left = this.and();
    while (this.isWord('or')) {
      this.next();
      const right = this.and();
      left = left || right;
    }
    return left;
  }

  private and(): boolean {
    let left = this.not();
    while (this.isWord('and')) {
      this.next();
      const right = this.not();
      left = left && right;
    }
    return left;
  }

  private not(): boolean {
    if (this.isWord('not')) {
      this.next();
      return !this.not();
    }
    return this.comparison();
  }

  private comparison(): boolean {
    if (this.isOp('(')) {
      this.next();
      const inner = this.or();
      if (!this.isOp(')')) throw new Error('Missing ) in condition.');
      this.next();
      return inner;
    }

    const left = this.operand();

    const token = this.peek();
    let op: string | null = null;
    if (token.kind === 'op' && OPERATORS.includes(token.value)) op = token.value;
    else if (token.kind === 'word' && WORD_OPERATORS.includes(token.value.toLowerCase())) {
      op = token.value.toLowerCase();
    }

    // No operator: the operand stands alone and is judged on truthiness.
    if (op === null) return isTruthy(left);

    this.next();
    const right = this.operand();
    return compare(left, op, right);
  }

  private operand(): Value {
    const token = this.next();

    if (token.kind === 'var') {
      if (Object.prototype.hasOwnProperty.call(this.context, token.name)) {
        return this.context[token.name]!;
      }
      // Falls through to the resolver, which reads paths straight out of the
      // step's response — so a nested status can be compared without first
      // publishing it as an output.
      const resolved = this.resolve?.(token.name);
      if (resolved !== undefined) return resolved;
      this.unknown.add(token.name);
      return '';
    }
    if (token.kind === 'string') return token.value;
    if (token.kind === 'number') return token.value;

    if (token.kind === 'word') {
      // Bare words are literals, so `{{s}} == completed` works unquoted. Runs
      // of them join into one value: statuses are routinely phrases such as
      // "in progress" or "Access Token", and requiring quotes around those
      // turned an ordinary condition into a parse error pointing at the second
      // word, which told the user nothing about what to do.
      let text = token.value;
      for (;;) {
        const next = this.peek();
        const isBareWord =
          next.kind === 'word' && !WORD_OPERATORS.includes(next.value.toLowerCase()) &&
          !['and', 'or', 'not'].includes(next.value.toLowerCase());
        const isNumber = next.kind === 'number';
        if (!isBareWord && !isNumber) break;
        text += ` ${(this.next() as { value: string }).value}`;
      }
      return text;
    }

    if (token.kind === 'op' && token.value === '[') {
      const items: string[] = [];
      if (this.isOp(']')) {
        this.next();
        return items;
      }
      for (;;) {
        const item = this.operand();
        if (Array.isArray(item)) throw new Error('Lists cannot be nested.');
        items.push(item);
        if (this.isOp(',')) {
          this.next();
          continue;
        }
        if (this.isOp(']')) {
          this.next();
          return items;
        }
        throw new Error('Expected , or ] in list.');
      }
    }

    throw new Error(`Expected a value in condition but found ${describe(token)}.`);
  }
}

function describe(token: Token): string {
  switch (token.kind) {
    case 'end':
      return 'end of expression';
    case 'var':
      return `{{${token.name}}}`;
    case 'string':
      return `"${token.value}"`;
    default:
      return `"${(token as { value: string }).value}"`;
  }
}

/** Numbers compare numerically; anything else compares as text. */
function compare(left: Value, op: string, right: Value): boolean {
  if (op === 'in') {
    const text = asText(left);
    if (Array.isArray(right)) return right.includes(text);
    return asText(right).includes(text);
  }

  if (op === 'contains') {
    if (Array.isArray(left)) return left.includes(asText(right));
    return asText(left).includes(asText(right));
  }

  if (op === 'matches') {
    let re: RegExp;
    try {
      re = new RegExp(asText(right));
    } catch (err) {
      throw new Error(`"${asText(right)}" is not a valid regular expression: ${(err as Error).message}`);
    }
    return re.test(asText(left));
  }

  const l = asText(left);
  const r = asText(right);

  const ln = Number(l);
  const rn = Number(r);
  const numeric = l.trim() !== '' && r.trim() !== '' && !Number.isNaN(ln) && !Number.isNaN(rn);

  switch (op) {
    case '==':
      return numeric ? ln === rn : l === r;
    case '!=':
      return numeric ? ln !== rn : l !== r;
    case '>':
      return numeric ? ln > rn : l > r;
    case '<':
      return numeric ? ln < rn : l < r;
    case '>=':
      return numeric ? ln >= rn : l >= r;
    case '<=':
      return numeric ? ln <= rn : l <= r;
    default:
      throw new Error(`Unknown operator "${op}".`);
  }
}

function asText(value: Value): string {
  return Array.isArray(value) ? value.join(',') : value;
}

export interface ConditionResult {
  value: boolean;
  /** Variables the expression referenced that the context does not hold. */
  unknown: string[];
}

/**
 * Evaluates `expression` against `context`.
 *
 * Unknown variables are reported rather than quietly treated as empty — the
 * whole tool refuses to paper over an undefined variable, and a condition that
 * silently goes false is the worst place to start.
 */
export function evaluateCondition(
  expression: string,
  context: Record<string, string>,
  resolve?: (name: string) => string | undefined,
): ConditionResult {
  const unknown = new Set<string>();
  const tokens = tokenize(expression);
  const value = new Evaluator(tokens, context, unknown, resolve).evaluate();
  return { value, unknown: [...unknown] };
}

/** Throws when the expression cannot be parsed. Used to validate as you type. */
export function checkCondition(expression: string): string | null {
  if (expression.trim() === '') return null;
  try {
    // Every variable resolves, so only syntax errors surface here.
    new Evaluator(
      tokenize(expression),
      new Proxy({}, { has: () => true, get: () => '' }) as Record<string, string>,
      new Set(),
    ).evaluate();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
