"use client";

import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonVariant } from "@/components/ui/button";
import type { FormState } from "@/lib/validation/schemas";

const FormStateContext = createContext<FormState & { pending?: boolean }>({});

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Formulaire relié à une action serveur. Affiche le message d'erreur ou de
 * succès renvoyé par le serveur et transmet les erreurs par champ aux <Field>.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
}: {
  action: Action;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Par défaut, le navigateur vide le formulaire après chaque envoi, même en
  // cas d'erreur. On envoie donc nous-mêmes, pour ne vider qu'en cas de succès.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <FormStateContext value={{ ...state, pending }}>
      <form ref={formRef} action={formAction} onSubmit={handleSubmit} className={className} noValidate>
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}
        {children}
      </form>
    </FormStateContext>
  );
}

const CONTROL =
  "block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint aria-[invalid=true]:border-danger";

type FieldProps = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "date";
  inputMode?: "decimal" | "text" | "email";
  maxLength?: number;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
};

export function Field({ name, label, type = "text", hint, required = true, ...rest }: FieldProps) {
  const state = use(FormStateContext);
  const id = useId();
  const errors = state.fieldErrors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, errors ? `${id}-error` : null].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        aria-invalid={errors ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={CONTROL}
        {...rest}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
      {errors ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-danger">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  required = false,
  defaultValue,
  rows = 3,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  rows?: number;
}) {
  const state = use(FormStateContext);
  const id = useId();
  const errors = state.fieldErrors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, errors ? `${id}-error` : null].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={errors ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`${CONTROL} h-auto py-2`}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
      {errors ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-danger">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function CheckboxField({ name, label }: { name: string; label: string }) {
  const state = use(FormStateContext);
  const id = useId();
  const errors = state.fieldErrors?.[name];
  return (
    <div>
      <div className="flex items-start gap-2">
        <input id={id} name={name} type="checkbox" value="true" className="mt-0.5 size-4 rounded border-line" />
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
      </div>
      {errors ? <p className="mt-1.5 text-xs font-medium text-danger">{errors.join(" ")}</p> : null}
    </div>
  );
}

type SelectFieldProps = {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
};

export function SelectField({ name, label, options, defaultValue }: SelectFieldProps) {
  const state = use(FormStateContext);
  const id = useId();
  const errors = state.fieldErrors?.[name];

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${id}-error` : undefined}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errors ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-danger">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  className?: string;
}) {
  const status = useFormStatus();
  const pending = use(FormStateContext).pending || status.pending;
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Un instant…" : children}
    </Button>
  );
}
