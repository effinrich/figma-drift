/** @jsxImportSource @emotion/react */
import { css } from '@emotion/react'

type Props = {
  variant: 'primary' | 'secondary'
  tone: 'danger' | 'safe'
}

// css tagged-template form with prop-driven conditional interpolation.
const baseStyles = css`
  color: ${(props: Props) =>
    props.variant === 'primary' ? 'white' : 'black'};
`

// css() object-styles form with an inline prop comparison.
const toneStyles = (props: Props) =>
  css({
    background: props.tone === 'danger' ? 'red' : 'green'
  })

export function EmotionCssButton(props: Props) {
  return (
    <button css={[baseStyles, toneStyles(props)]} type="button">
      Click
    </button>
  )
}
