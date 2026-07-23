import { CircleHelp } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState
} from 'react';

export function HelpPopover({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tooltipWidth = Math.min(300, window.innerWidth - 24);
      const tooltipHeight = tooltipRef.current?.getBoundingClientRect().height ?? 96;
      const fitsBelow = rect.bottom + 6 + tooltipHeight <= window.innerHeight - 12;
      const preferredTop = fitsBelow ? rect.bottom + 6 : rect.top - tooltipHeight - 6;
      setPosition({
        left: Math.max(12, Math.min(window.innerWidth - tooltipWidth - 12, rect.right - tooltipWidth)),
        top: Math.max(12, Math.min(window.innerHeight - tooltipHeight - 12, preferredTop))
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, text]);

  return <><button ref={triggerRef} className="help" aria-label={`了解${label}`} aria-describedby={open ? tooltipId : undefined}
    aria-expanded={open} type="button"
    onClick={event => {
      event.stopPropagation();
      setOpen(current => !current);
    }}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)}
    onBlur={() => setOpen(false)}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    }}>
    <CircleHelp size={17} aria-hidden="true" />
  </button>
  {open && createPortal(<span ref={tooltipRef} id={tooltipId} className="help-popover" role="tooltip"
    style={{ left: position.left, top: position.top }}>{text}</span>, document.body)}</>;
}

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly title?: string;
  readonly className?: string;
}

export function AccessibleTabs({
  ariaLabel, className, itemClassName, items, value, onChange, panelId, tabIdPrefix
}: {
  ariaLabel: string;
  className: string;
  itemClassName: string;
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
  panelId?: string;
  tabIdPrefix?: string;
}) {
  const tabListId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, items.findIndex(item => item.id === value));

  function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  }

  return <div className={className} role="tablist" aria-label={ariaLabel}>
    {items.map((item, index) => {
      const selected = item.id === value;
      const tabId = tabIdPrefix ? `${tabIdPrefix}-${index}` : `${tabListId}-tab-${index}`;
      return <button type="button" role="tab" key={item.id}
        ref={element => { refs.current[index] = element; }}
        id={tabId}
        aria-selected={selected}
        aria-controls={panelId}
        tabIndex={selected || (value === '' && index === activeIndex) ? 0 : -1}
        className={`${itemClassName} ${selected ? 'active' : ''} ${item.className ?? ''}`.trim()}
        title={item.title}
        onClick={() => onChange(item.id)}
        onKeyDown={event => moveFocus(event, index)}>
        {item.label}
      </button>;
    })}
  </div>;
}

export function Dialog({
  open, onClose, labelledBy, className, children
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');

    const focusableSelector = [
      'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
      'textarea:not([disabled])', '[href]', '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const focusInitial = window.requestAnimationFrame(() => {
      const initial = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial]')
        ?? dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      initial?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      window.removeEventListener('keydown', onKeyDown);
      root?.removeAttribute('inert');
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <section ref={dialogRef} className={className} role="dialog" aria-modal="true"
        aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </section>
    </div>,
    document.body
  );
}
