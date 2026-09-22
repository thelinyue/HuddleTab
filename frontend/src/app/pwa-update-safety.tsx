import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";

type ReleaseUpdateLock = () => void;
type AcquireUpdateLock = () => ReleaseUpdateLock;

const AcquireUpdateLockContext = createContext<AcquireUpdateLock | null>(null);
const UpdateLockedContext = createContext(false);
const acquireNoopLock: AcquireUpdateLock = () => () => undefined;

/**
 * 应用级 PWA 更新锁。编辑器和设置页只声明自己是否仍持有本地草稿，
 * 由这里集中计数，避免多个嵌套界面中任意一个提前关闭就解除全部保护。
 */
export function PwaUpdateSafetyProvider({ children }: PropsWithChildren) {
  const lockCount = useRef(0);
  const [locked, setLocked] = useState(false);

  const acquire = useCallback<AcquireUpdateLock>(() => {
    lockCount.current += 1;
    setLocked(true);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      lockCount.current = Math.max(0, lockCount.current - 1);
      setLocked(lockCount.current > 0);
    };
  }, []);

  return (
    <AcquireUpdateLockContext.Provider value={acquire}>
      <UpdateLockedContext.Provider value={locked}>
        {children}
      </UpdateLockedContext.Provider>
    </AcquireUpdateLockContext.Provider>
  );
}

/** 在当前组件有未保存状态时持有更新锁，组件卸载或草稿清空后自动释放。 */
export function usePwaUpdateBlock(active = true) {
  const acquire = useContext(AcquireUpdateLockContext) ?? acquireNoopLock;

  useEffect(() => {
    if (!active) return;
    return acquire();
  }, [active, acquire]);
}

/** 更新提示使用这个只读状态决定是否可以激活新版。 */
export function usePwaUpdateBlocked() {
  return useContext(UpdateLockedContext);
}
