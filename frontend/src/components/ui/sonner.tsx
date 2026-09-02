import { Toaster as Sonner } from 'sonner'
import { useTheme } from '@/components/theme'

type ToasterProps = React.ComponentProps<typeof Sonner>

/** 全局 Toast（sonner），跟随明暗主题。 */
export function Toaster(props: ToasterProps) {
  const { theme } = useTheme()
  return (
    <Sonner
      theme={theme}
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-lg text-[13px]',
        },
      }}
      {...props}
    />
  )
}
