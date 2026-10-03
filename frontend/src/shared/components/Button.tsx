import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  full?: boolean;
}

/**
 * Botón genérico del design system (clases `.btn` existentes).
 * Wrapper sin lógica: solo compone clases. CERO cambios visuales.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  full = false,
  className = '',
  type = 'button',
  ...rest
}) => {
  const classes = ['btn', `btn--${variant}`, full ? 'btn--full' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/**
 * Botón solo-icono (clase `.btn-icon` existente).
 */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  className = '',
  type = 'button',
  ...rest
}) => {
  return (
    <button
      type={type}
      className={['btn-icon', className].filter(Boolean).join(' ')}
      title={label}
      aria-label={label}
      {...rest}
    />
  );
};

export default Button;
