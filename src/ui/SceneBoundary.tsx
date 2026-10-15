import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface SceneBoundaryProps {
  readonly children?: ReactNode
  /** Called once with the error that took the 3D layer down. */
  readonly onError: (error: unknown, componentStack?: string | null) => void
}

interface SceneBoundaryState {
  readonly failed: boolean
}

/**
 * Error boundary around the lazy 3D layer. R3F rethrows scene errors out of
 * <Canvas> (and a failed chunk import throws here too); without this the
 * whole App unmounts. On error it renders nothing and reports, so the caller
 * can switch to the readable HTML layer while the header/nav stay mounted.
 */
export class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  override state: SceneBoundaryState = { failed: false }

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info.componentStack)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
