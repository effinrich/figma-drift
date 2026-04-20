import * as React from 'react'

function Card({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }) {
  return (
    <div
      className="flex flex-col gap-4 rounded-xl bg-card py-4 text-card-foreground ring-1 ring-foreground/10 px-4"
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className="grid gap-1 px-4" {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className="text-base font-medium" {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className="text-sm text-muted-foreground" {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className="px-4" {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className="flex items-center border-t bg-muted/50 p-4" {...props} />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
