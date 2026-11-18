"use client";

import { startTransition, useActionState, type FormEvent } from "react";

import type { BookingSettingsState } from "@/server/booking/actions";

export type SettingsAction = (previous: BookingSettingsState, formData: FormData) => Promise<BookingSettingsState>;

const IDLE: BookingSettingsState = { status: "idle" };

/** Submitted through a transition rather than `action=`, so that React keeps the typed values when they are refused. */
function submitWith(dispatch: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
}

export function useSettingsForm(action: SettingsAction) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  return { state, pending, submit: submitWith(dispatch) };
}
