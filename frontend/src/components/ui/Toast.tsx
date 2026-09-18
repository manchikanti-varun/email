// Imperative toast primitive with a tiny event bus, so any module can call
// toast(msg) without prop-drilling. The <Toaster/> mounted once at the app root
// renders them. Behavior preserved verbatim from the original Toaster.tsx.
import { useEffect, useState } from 'react';

interface ToastItem {
  id: number;
  msg: string;
}

type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function toast(msg: string): void {
  const item = { id: nextId++, msg };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (item) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }, 2600);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <>
      {items.map((i) => (
        <div key={i.id} className="toast">
          {i.msg}
        </div>
      ))}
    </>
  );
}
