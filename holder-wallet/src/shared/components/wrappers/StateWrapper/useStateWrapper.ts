import { ForwardedRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import i18next from 'i18next'
import { bundleName } from './constants'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { StateWrapperRef, StateWrapperReloadOptions } from './type'
import { StateWrapperProps, StateWrapperStatus, StateWrapperViewProps } from './component.types'

const useStateWrapper = <T>(
  props: StateWrapperProps<T>,
  ref: ForwardedRef<StateWrapperRef>,
): StateWrapperViewProps<T> => {
  i18next.addResourceBundle('sk', bundleName, localeSK)
  i18next.addResourceBundle('en', bundleName, localeEN)
  const [state, setState] = useState<{ status: StateWrapperStatus; data?: T | any }>({ status: 'loading', data: '' })
  const mountedRef = useRef(true)
  const loadingRef = useRef(false)
  const queuedReloadRef = useRef<StateWrapperReloadOptions | null>(null)
  const initialFunctionRef = useRef(props.initialFunction)
  const emptyStateConditionRef = useRef(props.emptyStateCondition)
  initialFunctionRef.current = props.initialFunction
  emptyStateConditionRef.current = props.emptyStateCondition

  const load = useCallback(async (options: StateWrapperReloadOptions = {}) => {
    if (loadingRef.current) {
      const queued = queuedReloadRef.current
      queuedReloadRef.current = {
        silent: queued ? queued.silent === true && options.silent === true : options.silent === true,
      }
      return
    }
    loadingRef.current = true
    if (!options.silent) setState({ status: 'loading' })
    try {
      const data = await initialFunctionRef.current()
      if (!mountedRef.current) return
      setState(emptyStateConditionRef.current?.(data) ? { status: 'empty-state' } : { status: 'completed', data })
    } catch (error) {
      if (mountedRef.current && !options.silent) setState({ status: 'error', data: (error as any).message })
    } finally {
      loadingRef.current = false
      const queued = queuedReloadRef.current
      queuedReloadRef.current = null
      if (mountedRef.current && queued) void load(queued)
    }
  }, [])

  useImperativeHandle(ref, () => ({ reload: (options) => void load(options) }), [load])
  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      queuedReloadRef.current = null
    }
  }, [load])

  return {
    ...state,
    renderData: props.renderData,
    renderEmptyState: props.renderEmptyState,
    renderError: props.renderError,
    containerStyle: props.containerStyle,
  }
}
export default useStateWrapper
