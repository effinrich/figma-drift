import styled from '@emotion/styled'

const EmotionButton = styled.button`
  display: inline-flex;
  align-items: center;
  background: ${props =>
    props.variant === 'primary'
      ? 'var(--primary)'
      : props.variant === 'secondary'
        ? 'var(--secondary)'
        : 'transparent'};
  padding: ${({ size }) => (size === 'lg' ? '12px 16px' : '8px 12px')};
  border-radius: ${({ size }) => (size === 'sm' ? '4px' : '8px')};
`

export { EmotionButton }
