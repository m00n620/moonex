import {
  confirm as baseConfirm,
  input as baseInput,
  password as basePassword,
  select as baseSelect,
  Separator,
} from '@inquirer/prompts';

/** Thrown when the user asks to go back (Esc, or the "← Back" choice). */
export class GoBack extends Error {
  override name = 'GoBack';
}

export const isGoBack = (error: unknown): error is GoBack => error instanceof GoBack;

const BACK = Symbol('back');

/** Counts prompts actually shown, so `runSteps` can skip steps that resolved without asking anything. */
let promptsShown = 0;

type Key = { name?: string; ctrl?: boolean; meta?: boolean };

/** Runs a prompt that rejects with GoBack when Esc is pressed while it is open. */
async function withEscape<R>(run: (context: { signal: AbortSignal }) => Promise<R>): Promise<R> {
  promptsShown++;
  const controller = new AbortController();
  const onKeypress = (_: string, key?: Key) => {
    if (key?.name === 'escape') controller.abort();
  };
  process.stdin.on('keypress', onKeypress);
  try {
    return await run({ signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new GoBack();
    throw error;
  } finally {
    process.stdin.off('keypress', onKeypress);
  }
}

export const input = (config: Parameters<typeof baseInput>[0]) => withEscape((context) => baseInput(config, context));

export const password = (config: Parameters<typeof basePassword>[0]) =>
  withEscape((context) => basePassword(config, context));

export const confirm = (config: Parameters<typeof baseConfirm>[0]) =>
  withEscape((context) => baseConfirm(config, context));

/** Like inquirer's select, with a "← Back" choice appended. */
export async function select<const Value>(config: Parameters<typeof baseSelect<Value>>[0]): Promise<Value> {
  const answer = await withEscape((context) =>
    baseSelect<Value | typeof BACK>(
      { ...config, choices: [...config.choices, new Separator(), { name: '← Back', value: BACK }] },
      context,
    ),
  );
  if (answer === BACK) throw new GoBack();
  return answer as Value;
}

/** A step returns `false` to end the flow early (e.g. nothing to choose from). */
export type Step = () => Promise<unknown>;

/**
 * Runs steps in order. Going back from a step re-runs the previous step that showed a prompt;
 * going back from the first one rethrows GoBack so the caller returns to its menu.
 * Returns false if a step ended the flow early.
 */
export async function runSteps(steps: Step[]): Promise<boolean> {
  const history: number[] = [];
  let index = 0;

  while (index < steps.length) {
    const before = promptsShown;
    try {
      if ((await steps[index]!()) === false) return false;
      if (promptsShown > before) history.push(index);
      index++;
    } catch (error) {
      if (!isGoBack(error)) throw error;
      const previous = history.pop();
      if (previous === undefined) throw error;
      index = previous;
    }
  }

  return true;
}
