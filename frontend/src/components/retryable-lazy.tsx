import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ComponentProps, type ReactNode } from "react";
import { Button, LoadingState } from "./ui";

/** 加载失败只替换当前内容区域；重试创建新的 lazy 实例，避免复用被拒绝的 Promise。 */
class LoadingBoundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="notice notice--error" role="alert">页面内容加载失败，请检查网络后重试。<Button variant="secondary" onClick={this.props.retry}>重新加载</Button></div>
      : this.props.children;
  }
}

export function retryableLazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, fallback: ReactNode = <LoadingState label="正在加载编辑器…" />) {
  return function DeferredComponent(props: ComponentProps<T>) {
    const [attempt, setAttempt] = useState(0);
    const Content = useMemo(() => lazy(load), [attempt]);
    return <LoadingBoundary key={attempt} retry={() => setAttempt(value => value + 1)}><Suspense fallback={fallback}><Content {...props} /></Suspense></LoadingBoundary>;
  };
}
