"use client";

import { useState } from "react";
import type { SharingSettings } from "@/types/event-settings";

interface SharingTabProps {
  value: SharingSettings;
  onChange: (sharing: SharingSettings) => void;
}

const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

/**
 * SharingTab — Share defaults configured per-event.
 * These values are used as defaults when creating new share links.
 */
export function SharingTab({ value, onChange }: SharingTabProps) {
  const [showPin, setShowPin] = useState(false);

  const update = (partial: Partial<SharingSettings>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div>
      <h3 className="text-[15px] font-medium text-stone-900 mb-1">Sharing</h3>
      <p className="text-[12px] text-stone-400 mb-6">
        Default settings for new share links. These can be overridden per link.
      </p>

      <div className="space-y-5">
        {/* Toggle: Allow Downloads */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-stone-700">Allow downloads</p>
            <p className="text-[11px] text-stone-400">Clients can download individual photos and full gallery</p>
          </div>
          <button
            onClick={() => update({ allowDownload: !value.allowDownload })}
            className={`relative w-10 h-5 rounded-full transition-colors duration-300 shrink-0 ml-4 ${
              value.allowDownload ? "bg-accent" : "bg-stone-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 bg-white rounded-full shadow transition-transform duration-300 ${
                value.allowDownload ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>

        {/* Toggle: Allow Favorites */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-stone-700">Allow favorites</p>
            <p className="text-[11px] text-stone-400">Clients can mark photos as favorites</p>
          </div>
          <button
            onClick={() => update({ allowFavorites: !value.allowFavorites })}
            className={`relative w-10 h-5 rounded-full transition-colors duration-300 shrink-0 ml-4 ${
              value.allowFavorites ? "bg-accent" : "bg-stone-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 bg-white rounded-full shadow transition-transform duration-300 ${
                value.allowFavorites ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>

        <div className="border-t border-stone-100 pt-5">
          {/* Password */}
          <div className="mb-4">
            <label className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-400 mb-2 block">
              Password <span className="normal-case tracking-normal font-normal text-stone-300">(optional)</span>
            </label>
            <input
              type="text"
              value={value.password}
              onChange={(e) => update({ password: e.target.value })}
              placeholder="Leave empty for open access"
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[13px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>

          {/* Expiration */}
          <div className="mb-4">
            <label className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-400 mb-2 block">
              Expires <span className="normal-case tracking-normal font-normal text-stone-300">(optional)</span>
            </label>
            <input
              type="date"
              value={value.expiresAt}
              onChange={(e) => update({ expiresAt: e.target.value })}
              min={new Date().toISOString().split("T")[0]}
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[13px] text-stone-900 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>

          {/* Custom Message */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-400 mb-2 block">
              Message <span className="normal-case tracking-normal font-normal text-stone-300">(optional)</span>
            </label>
            <input
              type="text"
              value={value.customMessage}
              onChange={(e) => update({ customMessage: e.target.value })}
              placeholder="A note for your client"
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[13px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>
        </div>

        {/* Download Protection */}
        <div className="border-t border-stone-100 pt-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-400 mb-3">
            Download Protection
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-stone-600">
                Require PIN for Download All
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !value.requirePinBulk;
                  const pin = next && !value.downloadPin ? generatePin() : value.downloadPin;
                  update({ requirePinBulk: next, downloadPin: pin });
                }}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ml-4 ${
                  value.requirePinBulk ? "bg-stone-900" : "bg-stone-200"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    value.requirePinBulk ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[13px] text-stone-600">
                Require PIN for individual downloads
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !value.requirePinIndividual;
                  const pin = next && !value.downloadPin ? generatePin() : value.downloadPin;
                  update({ requirePinIndividual: next, downloadPin: pin });
                }}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ml-4 ${
                  value.requirePinIndividual ? "bg-stone-900" : "bg-stone-200"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    value.requirePinIndividual ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </div>

            {(value.requirePinBulk || value.requirePinIndividual) && (
              <div className="mt-3">
                <label className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-400 mb-2 block">
                  PIN Code
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={4}
                    value={value.downloadPin}
                    onChange={(e) =>
                      update({ downloadPin: e.target.value.replace(/\D/g, "").slice(0, 4) })
                    }
                    placeholder="4-digit PIN"
                    className="flex-1 border-b border-stone-200 bg-transparent py-2 text-[13px] text-stone-900 font-mono tracking-[0.3em] placeholder:text-stone-300 placeholder:tracking-normal placeholder:font-sans focus:border-stone-900 focus:outline-none transition-colors duration-300"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    className="text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    {showPin ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ downloadPin: generatePin() })}
                    className="text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    Generate
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
