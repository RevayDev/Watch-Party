import React, { forwardRef, useEffect, useRef, useImperativeHandle } from 'react';
import './ui.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' | 'unstyled';
type Size = 'sm' | 'md' | 'lg';
interface ActionStyle { variant?: Variant; size?: Size; }
function actionClasses(variant: Variant, size: Size, className?: string) { return ['ui-action', 'ui-action--' + variant, 'ui-action--' + size, className].filter(Boolean).join(' '); }
export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & ActionStyle>(function Button({ variant = 'secondary', size = 'md', className, ...props }, ref) {
  return <button ref={ref} className={actionClasses(variant, size, className)} {...props} />;
});
export const ActionLink = forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & ActionStyle>(function ActionLink({ variant = 'secondary', size = 'md', className, ...props }, ref) {
  return <a ref={ref} className={actionClasses(variant, size, className)} {...props} />;
});
export const Field = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Field({ className = '', type = 'text', ...props }, ref) {
  return <input ref={ref} type={type} className={['checkbox', 'radio', 'file', 'hidden', 'color'].includes(type) ? 'ui-native-field ' + className : 'ui-field ' + className} {...props} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...props }, ref) {
  return <select ref={ref} className={'ui-field ui-select ' + className} {...props} />;
});
export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={'ui-field ui-textarea ' + className} {...props} />;
});
export const Range = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Range({ className = '', min = 0, max = 100, value, defaultValue, style, onChange, ...props }, ref) {
  const [localValue, setLocalValue] = React.useState(defaultValue ?? min);
  const numericValue = Number(value ?? localValue);
  const progress = Math.max(0, Math.min(100, (numericValue - Number(min)) / (Number(max) - Number(min) || 1) * 100));
  return <input {...props} ref={ref} type="range" min={min} max={max} value={value} defaultValue={defaultValue} className={'ui-range ' + className} style={{ ...style, '--range-progress': progress + '%' } as React.CSSProperties} onChange={event => { setLocalValue(event.target.value); onChange?.(event); }} />;
});
export const Surface = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Surface({ className = '', ...props }, ref) {
  return <div ref={ref} className={'ui-surface ' + className} {...props} />;
});
export const AccordionTrigger = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { expanded: boolean; controls: string }>(function AccordionTrigger({ expanded, controls, ...props }, ref) {
  return <Button {...props} ref={ref} type="button" variant="unstyled" aria-expanded={expanded} aria-controls={controls} />;
});
export const Popover = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { onDismiss?: () => void }>(function Popover({ className = '', onDismiss, children, ...props }, ref) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => root.current as HTMLDivElement);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!dismiss.current) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); dismiss.current?.(); previousFocus?.focus(); } };
    const onOutside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && event.target !== previousFocus && !(previousFocus !== document.body && previousFocus?.contains(event.target))) dismiss.current?.(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onOutside); };
  }, []);
  return <div {...props} ref={root} className={'ui-popover ' + className}>{children}</div>;
});
