import { tv, type VariantProps } from 'tailwind-variants'

const button = tv({
  base: 'inline-flex items-center justify-center rounded-lg text-sm font-medium',
  variants: {
    variant: {
      primary: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
      ghost: 'hover:bg-muted'
    },
    size: {
      sm: 'h-7 gap-1 px-2',
      md: 'h-8 gap-1.5 px-3',
      lg: 'h-9 gap-2 px-4'
    }
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md'
  }
})

function TvButton({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof button>) {
  return <button className={button({ variant, size, className })} {...props} />
}

export { TvButton, button }
