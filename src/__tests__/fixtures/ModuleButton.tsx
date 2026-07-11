import classNames from 'classnames'
import styles from './ModuleButton.module.css'

type ModuleButtonProps = {
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}

function ModuleButton({ variant = 'primary', disabled }: ModuleButtonProps) {
  return (
    <button
      className={classNames(styles.root, styles.primary, styles.secondary, {
        [styles.disabled]: disabled
      })}
    >
      {variant}
    </button>
  )
}

export { ModuleButton }
