import { create } from 'zustand';

/**
 * In-app replacements for `window.prompt` and `window.confirm`.
 *
 * Electron does not implement `prompt()` — it throws "prompt() is not
 * supported" — which silently broke every "name this thing" flow. `confirm()`
 * does work, but the native sheet looks nothing like the rest of the app, so
 * both are handled here and awaited like their browser counterparts.
 */

export interface PromptRequest {
  kind: 'prompt';
  title: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel: string;
  resolve: (value: string | null) => void;
}

export interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (value: boolean) => void;
}

export interface ChoiceRequest {
  kind: 'choice';
  title: string;
  label: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  confirmLabel: string;
  resolve: (value: string | null) => void;
}

type DialogRequest = PromptRequest | ConfirmRequest | ChoiceRequest;

interface DialogState {
  current: DialogRequest | null;
  ask(options: {
    title: string;
    label?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
  }): Promise<string | null>;
  confirm(options: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }): Promise<boolean>;
  choose(options: {
    title: string;
    label?: string;
    options: Array<{ value: string; label: string; hint?: string }>;
    confirmLabel?: string;
  }): Promise<string | null>;
  dismiss(): void;
}

export const useDialogs = create<DialogState>((set, get) => ({
  current: null,

  ask: (options) =>
    new Promise<string | null>((resolve) => {
      set({
        current: {
          kind: 'prompt',
          title: options.title,
          label: options.label ?? 'Name',
          defaultValue: options.defaultValue ?? '',
          placeholder: options.placeholder ?? '',
          confirmLabel: options.confirmLabel ?? 'Create',
          resolve,
        },
      });
    }),

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        current: {
          kind: 'confirm',
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? 'Confirm',
          danger: options.danger ?? false,
          resolve,
        },
      });
    }),

  choose: (options) =>
    new Promise<string | null>((resolve) => {
      set({
        current: {
          kind: 'choice',
          title: options.title,
          label: options.label ?? 'Choose',
          options: options.options,
          confirmLabel: options.confirmLabel ?? 'Select',
          resolve,
        },
      });
    }),

  dismiss: () => {
    // Settle the pending promise so an awaiting caller is never left hanging.
    const { current } = get();
    if (current) {
      if (current.kind === 'confirm') current.resolve(false);
      else current.resolve(null);
    }
    set({ current: null });
  },
}));

/** Convenience wrappers so callers don't reach into the store directly. */
export const askName = (options: Parameters<DialogState['ask']>[0]) =>
  useDialogs.getState().ask(options);
export const askConfirm = (options: Parameters<DialogState['confirm']>[0]) =>
  useDialogs.getState().confirm(options);
export const askChoice = (options: Parameters<DialogState['choose']>[0]) =>
  useDialogs.getState().choose(options);
