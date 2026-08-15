"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

interface DatePickerProps {
  value: string; // YYYY-MM-DD or ""
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select a date",
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (value) {
      const [y, m] = value.split("-").map(Number);
      return { year: y, month: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  const formatDisplay = useCallback((dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return `${MONTHS[month - 1]} ${day}, ${year}`;
  }, []);

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();

  const getFirstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const prevMonth = () => {
    setViewDate((prev) =>
      prev.month === 0
        ? { year: prev.year - 1, month: 11 }
        : { ...prev, month: prev.month - 1 }
    );
  };

  const nextMonth = () => {
    setViewDate((prev) =>
      prev.month === 11
        ? { year: prev.year + 1, month: 0 }
        : { ...prev, month: prev.month + 1 }
    );
  };

  const selectDate = (dateStr: string) => {
    onChange(dateStr);
    setIsOpen(false);
  };

  const selectToday = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setViewDate({ year: y, month: now.getMonth() });
    setIsOpen(false);
  };

  // Today's date string for comparison
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewDate.year, viewDate.month);
  const firstDay = getFirstDayOfMonth(viewDate.year, viewDate.month);
  const daysInPrevMonth = getDaysInMonth(
    viewDate.month === 0 ? viewDate.year - 1 : viewDate.year,
    viewDate.month === 0 ? 11 : viewDate.month - 1
  );

  const cells: { day: number; currentMonth: boolean; dateStr: string }[] = [];

  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const pm = viewDate.month === 0 ? 11 : viewDate.month - 1;
    const py = viewDate.month === 0 ? viewDate.year - 1 : viewDate.year;
    cells.push({
      day,
      currentMonth: false,
      dateStr: `${py}-${String(pm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      currentMonth: true,
      dateStr: `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }

  // Next month leading days (fill to 42 = 6 rows)
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nm = viewDate.month === 11 ? 0 : viewDate.month + 1;
    const ny = viewDate.month === 11 ? viewDate.year + 1 : viewDate.year;
    cells.push({
      day: d,
      currentMonth: false,
      dateStr: `${ny}-${String(nm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }

  // Only show 6th row if it contains current-month days
  const showSixRows = cells.slice(35).some((c) => c.currentMonth);
  const displayCells = showSixRows ? cells : cells.slice(0, 35);

  return (
    <div ref={containerRef} className="relative">
      {/* ─── Trigger ─── */}
      <div
        className="flex items-center gap-3 h-12 border-b border-stone-200 cursor-pointer hover:border-stone-400 transition-colors duration-300"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Calendar className="h-4 w-4 text-stone-300 shrink-0" />
        <span
          className={cn(
            "text-[16px] flex-1",
            value ? "text-stone-900" : "text-stone-300"
          )}
        >
          {value ? formatDisplay(value) : placeholder}
        </span>
        {value && (
          <span
            className="text-[11px] text-stone-300 hover:text-stone-500 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          >
            Clear
          </span>
        )}
      </div>

      {/* ─── Calendar dropdown ─── */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-stone-200 shadow-xl w-[280px] select-none fade-in">
          {/* Month / Year header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 text-stone-300 hover:text-stone-900 transition-colors duration-200"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-editorial text-[16px] text-stone-900">
              {MONTHS[viewDate.month]}{" "}
              <span className="text-stone-400">{viewDate.year}</span>
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 text-stone-300 hover:text-stone-900 transition-colors duration-200"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 px-3 pt-3 pb-1">
            {DAYS.map((d, i) => (
              <div
                key={i}
                className="text-center text-[10px] uppercase tracking-[0.15em] font-medium text-stone-400"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 px-3 pb-2">
            {displayCells.map((cell, i) => {
              const isSelected = cell.dateStr === value;
              const isToday = cell.dateStr === todayStr && cell.currentMonth;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (cell.currentMonth) selectDate(cell.dateStr);
                  }}
                  className={cn(
                    "h-9 w-full text-[13px] transition-all duration-150 relative",
                    // Non-current month
                    !cell.currentMonth && "text-stone-200 pointer-events-none",
                    // Current month default
                    cell.currentMonth &&
                      !isSelected &&
                      "text-stone-700 hover:bg-stone-100",
                    // Selected
                    isSelected &&
                      cell.currentMonth &&
                      "bg-stone-900 text-white hover:bg-stone-800",
                    // Today (unselected)
                    isToday && !isSelected && "text-accent font-semibold"
                  )}
                >
                  {cell.day}
                  {/* Today dot indicator */}
                  {isToday && !isSelected && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-accent rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-stone-100">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setIsOpen(false);
              }}
              className="text-[11px] text-stone-400 hover:text-stone-700 transition-colors tracking-wide uppercase"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={selectToday}
              className="text-[11px] text-accent hover:text-accent-hover transition-colors tracking-wide uppercase font-medium"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * MonthPicker — the DatePicker's month-granularity sibling, for facts only as
 * precise as a month ("last hired Aug 2024").
 *
 * Exists because the native `<input type="month">` opens Chrome's stock blue
 * popup — exactly the off-brand chrome this file was written to replace.
 * Mason's layout: "put the years as a scrollable list on the right of the
 * months" — so the panel is two columns, months as a 3×4 grid on the left and
 * a year rail on the right, newest year first because "when did we last hire
 * them" looks backward from now. The rail auto-centres on the year in view.
 *
 * Same vocabulary as the DatePicker above: Playfair header, stone surfaces,
 * stone-900 selection, the accent reserved for NOW (this month, this year).
 *
 * Value speaks `YYYY-MM`, the native input's dialect, so call sites swap
 * without touching their state.
 */
const MONTH_YEARS_BACK = 20;

export function MonthPicker({
  value,
  onChange,
  placeholder = "Month",
}: {
  value: string; // YYYY-MM or ""
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() =>
    /^\d{4}-\d{2}$/.test(value) ? Number(value.slice(0, 4)) : new Date().getFullYear()
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const yearRailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", key);
    };
  }, [isOpen]);

  // Centre the rail on the year in view when the panel opens.
  useEffect(() => {
    if (!isOpen) return;
    const el = yearRailRef.current?.querySelector<HTMLElement>("[data-current='true']");
    el?.scrollIntoView({ block: "center" });
  }, [isOpen, viewYear]);

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonthStr = `${thisYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const years = Array.from({ length: MONTH_YEARS_BACK + 1 }, (_, i) => thisYear - i);
  const display = /^\d{4}-\d{2}$/.test(value)
    ? `${MONTHS[Number(value.slice(5, 7)) - 1].slice(0, 3)} ${value.slice(0, 4)}`
    : null;

  const pick = (monthIndex: number) => {
    onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* ─── Trigger ─── */}
      <button
        type="button"
        onClick={() => {
          if (!isOpen && /^\d{4}-\d{2}$/.test(value)) setViewYear(Number(value.slice(0, 4)));
          setIsOpen((v) => !v);
        }}
        className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-[12px] transition-colors hover:border-stone-400"
      >
        <Calendar className="h-3.5 w-3.5 text-stone-300" />
        <span className={display ? "text-stone-700" : "text-stone-300"}>
          {display ?? placeholder}
        </span>
      </button>

      {/* ─── Panel ─── */}
      {isOpen && (
        <div className="fade-in absolute left-0 top-full z-50 mt-2 w-[264px] select-none border border-stone-200 bg-white shadow-xl">
          {/* The header reads like a sentence being finished: the year in view,
              set in the editorial serif, same as the DatePicker's header. */}
          <div className="border-b border-stone-100 px-4 py-3">
            <span className="font-editorial text-[16px] text-stone-900">
              {display ?? "Pick a month"}{" "}
            </span>
          </div>

          <div className="flex">
            {/* Months, 3×4 */}
            <div className="grid flex-1 grid-cols-3 gap-1 p-3">
              {MONTHS.map((m, i) => {
                const monthStr = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                const isSelected = monthStr === value;
                const isThisMonth = monthStr === thisMonthStr;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pick(i)}
                    className={cn(
                      "relative h-9 text-[13px] transition-all duration-150",
                      !isSelected && "text-stone-700 hover:bg-stone-100",
                      isSelected && "bg-stone-900 text-white hover:bg-stone-800",
                      isThisMonth && !isSelected && "font-semibold text-accent"
                    )}
                  >
                    {m.slice(0, 3)}
                    {isThisMonth && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* The year rail — scrollable, newest first, auto-centred. */}
            <div
              ref={yearRailRef}
              className="max-h-[192px] w-[68px] overflow-y-auto border-l border-stone-100 py-1.5"
            >
              {years.map((y) => {
                const isViewed = y === viewYear;
                const isSelectedYear = value.slice(0, 4) === String(y);
                return (
                  <button
                    key={y}
                    type="button"
                    data-current={isViewed ? "true" : undefined}
                    onClick={() => setViewYear(y)}
                    className={cn(
                      "block w-full px-2 py-1.5 text-center text-[13px] tabular-nums transition-colors duration-150",
                      isViewed
                        ? "bg-stone-900 text-white"
                        : isSelectedYear
                          ? "text-stone-900 font-semibold hover:bg-stone-100"
                          : y === thisYear
                            ? "font-semibold text-accent hover:bg-stone-100"
                            : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                    )}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer — same grammar as the DatePicker's Clear / Today. */}
          <div className="flex items-center justify-between border-t border-stone-100 px-4 py-2.5">
            <button
              type="button"
              onClick={() => { onChange(""); setIsOpen(false); }}
              className="text-[11px] uppercase tracking-wide text-stone-400 transition-colors hover:text-stone-700"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setViewYear(thisYear);
                onChange(thisMonthStr);
                setIsOpen(false);
              }}
              className="text-[11px] font-medium uppercase tracking-wide text-accent transition-colors hover:text-accent-hover"
            >
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
