// @vitest-environment jsdom
import React, { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccordionTrigger, Button, Field, Popover, Range, Select } from '../src/shared/components/ui';
afterEach(cleanup);
it('preserves form submission, disabled state and native refs through shared controls', () => {
  const submit = vi.fn(event => event.preventDefault());
  const button = createRef<HTMLButtonElement>();
  const field = createRef<HTMLInputElement>();
  render(<form onSubmit={submit}><Field ref={field} aria-label="Nombre" required /><Button ref={button} variant="primary" type="submit">Guardar</Button><Button disabled onClick={submit}>Deshabilitado</Button></form>);
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(field.current?.value).toBe('Ana');
  expect(button.current?.tagName).toBe('BUTTON');
  fireEvent.click(screen.getByRole('button', { name: 'Deshabilitado' }));
  expect(submit).toHaveBeenCalledTimes(1);
});
it('keeps selects native and accordion state controlled and keyboard-accessible', () => {
  const change = vi.fn(); const toggle = vi.fn();
  render(<><Select aria-label="Servidor" defaultValue="host" onChange={change}><option value="host">Anfitrión</option><option value="render">Render</option></Select><AccordionTrigger expanded={false} controls="queue" onClick={toggle}>Cola</AccordionTrigger></>);
  fireEvent.change(screen.getByLabelText('Servidor'), { target: { value: 'render' } });
  expect(change).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button').getAttribute('aria-controls')).toBe('queue');
  fireEvent.click(screen.getByRole('button')); expect(toggle).toHaveBeenCalledTimes(1);
});
it('normalizes range progress with non-zero minimums and forwards changes', () => {
  const change = vi.fn();
  render(<Range aria-label="Volumen" min={20} max={80} value={50} onChange={change} />);
  const range = screen.getByRole('slider');
  expect(range.style.getPropertyValue('--range-progress')).toBe('50%');
  fireEvent.change(range, { target: { value: '60' } });
  expect(change).toHaveBeenCalledTimes(1);
});
it('dismisses only the popup on Escape and restores focus to its trigger', () => {
  const dismiss = vi.fn(); const outer = vi.fn();
  const view = render(<Button>Abrir</Button>);
  const trigger = screen.getByRole('button'); trigger.focus();
  view.rerender(<><Button>Abrir</Button><Popover onDismiss={dismiss}><Button>Acción</Button></Popover></>);
  document.addEventListener('keydown', outer);
  screen.getByRole('button', { name: 'Acción' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  document.removeEventListener('keydown', outer);
});
it('dismisses a popup on outside pointer input', () => {
  const dismiss = vi.fn();
  render(<><Popover onDismiss={dismiss}><Button>Acción</Button></Popover><p>Fuera</p></>);
  fireEvent.pointerDown(screen.getByText('Fuera'));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
