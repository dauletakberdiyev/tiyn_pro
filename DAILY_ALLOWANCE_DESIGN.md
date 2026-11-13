# Today's remaining allowance: investigation

Investigated and implemented on 13 November 2026. The rules below describe the implemented daily remaining allowance; the first section records the original problem.

## Finding

The home card promises an answer to “how much can I still spend today?” but displays a changing average for the whole remaining period. Every purchase is spread over that period, so exhausting today's allowance can still leave a positive number on the card.

Previously, the shared `allowance()` function in `supabase/functions/_shared/domain.ts` calculated:

```text
free now = balance of included accounts − unpaid reserved bills − reserve
daily average = floor to whole tenge(free now / remaining days)
```

Previously, the home card displayed `daily` under “Можно потратить сегодня”. The explanation sheet showed the period calculation without today's spending or a remaining allowance. The mobile card also hid the bottom explanatory row.

The original specification in `APP_V1.md`, section 7, describes this average correctly. Implementing a remaining allowance needs a calculation change as well as new copy.

## Recommended behavior

Show **“Осталось на сегодня”** as the primary number. Ordinary purchases reduce it by their full amount. Do not let those purchases lower today's plan at the same time.

Always show the two supporting amounts, including on mobile:

| Card content | Meaning |
| --- | --- |
| Осталось на сегодня | What remains of today's spending allowance, minimum zero |
| План на день | Today's allowance before today's ordinary spending |
| Потрачено сегодня | Ordinary spending from accounts included in the calculation |
| Превышение за день | Spending above today's allowance, when positive |
| До дохода: 19 дней | Secondary context for how the plan was calculated |

A compact card should keep the remaining amount largest, place the plan and spending below it, and retain the arrow to the calculation sheet. A muted warm warning color can indicate daily overspending. A deficit for the entire period needs its own explicit message and amount in the explanation, even when today's remaining allowance is zero.

The explanation sheet should present `plan − today's spending = remaining` first. Follow it with account balances, reserved bills, reserve, and the period used to form the plan. Separate paid reserved bills from ordinary spending so the displayed totals reconcile.

## Calculation proposal

The existing ledger can support the desired purchase behavior without storing a daily allowance snapshot:

```text
F = current free money from the existing allowance calculation
D = remaining days, including today
S = today's ordinary expenses on included accounts
    − today's refunds on included accounts
    (exclude transactions linked to paid reserved bills)

today's plan = max(0, floor to whole tenge((F + S) / D))
raw remaining = today's plan − S
shown remaining = max(0, min(F, raw remaining))
daily overspending = max(0, −raw remaining)
period deficit = max(0, −F)
```

Adding `S` back before dividing reconstructs the pool before today's ordinary spending. Subtracting `S` after dividing charges today's purchases in full. For an additional purchase `X`, `F` falls by `X` and `S` grows by `X`: the plan stays the same and raw remaining falls by exactly `X`.

The free-money cap matters for refunds. A refund of an earlier purchase can exceed today's expenses; the card must still avoid recommending more spending than the free money actually available. The explanation should show refunds separately when necessary instead of labeling a negative net amount as spending.

This derived plan is stable during ordinary spending, editing, and deletion. Actual income, changes to the reserve or planning period, changes to included accounts, and other changes to the funding pool recalculate the plan. Describe such changes as a recalculated plan; do not claim the amount is an immutable snapshot taken at midnight.

If an allowance that never changes during a calendar day is later required, add a shared daily record with explicit rules for income, corrections, and plan changes. The present book schema does not contain daily snapshots or historical settings. Saving a number only in browser storage would disagree with the bot and other devices.

## Example matching the reported symptom

Only the screenshot's 9,303 ₸ and 19 days, plus the reported spending of 23,889 ₸, are known. The following uses an **illustrative** free balance before spending of 200,655 ₸, with no bills or reserve, to reproduce the screenshot. It is not a reconstruction of the user's account.

| Point in time | Existing card | Proposed remaining | Today's plan | Daily overspending |
| --- | ---: | ---: | ---: | ---: |
| Before spending | 10,560 ₸ | 10,560 ₸ | 10,560 ₸ | 0 ₸ |
| After spending 23,889 ₸ | 9,303 ₸ | 0 ₸ | 10,560 ₸ | 13,329 ₸ |
| After spending another 1,500 ₸ | 9,224 ₸ | 0 ₸ | 10,560 ₸ | 14,829 ₸ |
| Tomorrow, after the 23,889 ₸ spending only | 9,820 ₸ | 9,820 ₸ | 9,820 ₸ | 0 ₸ |

Tomorrow the remaining 176,766 ₸ is divided over 18 days. This redistributes both underspending and overspending across the remaining period. It does not carry today's full overspending forward as a separate charge on top of that recalculation.

## Rules to preserve

| Event | Effect on today's allowance |
| --- | --- |
| Ordinary purchase from an included account | Reduce raw remaining by the full purchase amount |
| Edit or delete today's purchase | Apply or restore the full difference |
| Refund on an included account | Restore today's allowance, subject to available free money; show refunds clearly |
| Pay a bill already reserved for this period | Exclude its linked transaction from ordinary spending; releasing the reservation offsets payment |
| Actual bill amount differs from its reservation | Recalculate the plan using the difference in the funding pool |
| Pay a bill outside this period early | Treat it as a funding change and recalculate; it had not been reserved in this period |
| Unlinked manual bill payment | It remains an ordinary expense until linked; make the existing linking action easy to find |
| Transfer between included accounts | No change |
| Expense paid from an excluded savings account | No change to this card; it remains visible in overall expense reports |
| Transfer into or out of excluded savings | Recalculate from the changed spending pool; show it as a transfer, not ordinary spending |
| Debt payment not covered by a reserved bill | Recalculate the funding pool; keep debt movement separate from ordinary expense totals |
| Income actually received | Recalculate the plan from the larger funding pool; keep today's recorded spending deduction |
| Expected income not yet received | Do not add it to available money |
| Backdated correction | Recalculate today's plan from the corrected history |
| New local calendar day | Start a new plan from the remaining pool; today's spending starts at zero |
| No future income configured | Retain the end-of-month fallback and explain it |
| Last day of the period | Use one day; subtract spending exactly once |
| Monthly and category limits | Retain their separate warnings; combining these limits with this card is a separate product change |

Transactions use the financial `date`, not their creation timestamp, to identify today's spending. Day changes must follow `book.settings.timezone`. `src/App.tsx` already updates its clock every minute; a resume/focus refresh should also update the clock so a suspended Telegram view switches days immediately.

Paid bills are linked through `schedule.completed[].transactionId`, which is enough for the common case. Their transaction's actual account must be checked when determining whether it affects the included pool. Archiving a paid schedule must not turn its payment into an ordinary purchase. Existing manual payment linking is explicit; matching a bill automatically by amount or category would be unreliable.

## Implementation scope

1. Keep period totals available from the shared domain helper and add explicit outputs for today's plan, spending, remaining allowance, and overspending. Preserve the current average only where it is explicitly labeled as an average.
2. Update the home card and calculation sheet together, including mobile support for today's plan/spending and distinct daily overspending versus period deficit states.
3. Use the same derived result for app and bot views that expose this number. The ledger and explicit schedule links already synchronize through the existing book state; the proposed derived calculation adds no persisted field.
4. Update the clock on app focus/resume and update section 7 of the product specification when the change is implemented.
5. Production tests cover full purchase deductions, refunds, bill completion/linking/deletion, different accounts, actual income, transfers, backdated edits, period deficits, local day boundaries, bill variances, early payments, and archived paid schedules.

## Verification performed

- Existing domain suite: **29 tests passed**.
- A temporary prototype executed against the actual domain commands passed **9 scenario checks**: reproducing the displayed number with an illustrative balance; full purchase deductions; edits/deletions; reserved bill completion; internal transfers and excluded-account expenses; received income; refunds with the free-money cap; next-day recalculation; and a one-day horizon.
- The prototype lives outside application source at `/tmp/tiyn-daily-allowance-investigation.mts`. It is evidence for this proposal, not production code or a substitute for the remaining coverage above.
- Implementation adds regression coverage in `tests/allowance.test.ts` and `tests/allowance-view.test.ts`, including bill variances, early payments, archived schedules, and actual payment accounts.
- Final implementation validation: **95 tests passed**, production build passed, and all four Edge Function entry points passed Deno checking. Browser verification at desktop, 390 px, and 320 px confirmed the updated card and full purchase deduction in a local demo.
- No production account data was queried. The updated UI was checked using a local demo budget.
