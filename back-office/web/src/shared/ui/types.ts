import type {
  ButtonHTMLAttributes,
  ElementType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
} from 'react';

/** Common presentation properties for a component whose HTML element can be selected. */
export type SlotProps = HTMLAttributes<HTMLElement> & { as?: ElementType };
/** Existing console button variants and native button behavior. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  as?: ElementType;
  block?: boolean;
  size?: string;
  variant?: string;
};
/** Labeled form field with optional validation and help text. */
export type FieldProps = {
  children?: ReactNode;
  className?: string;
  error?: ReactNode;
  hint?: ReactNode;
  id?: string;
  label?: ReactNode;
};
/** Native selection field with the console's surrounding label and validation. */
export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldProps & { fieldClassName?: string; invalid?: boolean };
/** Existing input appearance together with native input attributes. */
export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  mono?: boolean;
};
/** Existing scrollable table and spacing options. */
export type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  scroll?: boolean;
  spaced?: boolean;
  wrapperClassName?: string;
};
/** Confirmation content and callbacks controlled by the owning workflow. */
export type ConfirmDialogProps = {
  busy?: boolean;
  cancelLabel?: ReactNode;
  children?: ReactNode;
  confirmLabel?: ReactNode;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: ReactNode;
};
/** One selectable value and its operator-facing label. */
export type Choice = { value: string; label: ReactNode };
/** Segmented selection controlled by the owning workflow. */
export type SegmentedControlProps = {
  ariaLabel?: string;
  className?: string;
  onChange: (value: string) => void;
  options: Choice[];
  value: string;
};
