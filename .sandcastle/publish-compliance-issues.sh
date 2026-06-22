#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ISSUES_DIR="$ROOT/.sandcastle/issues"

declare -A NUM=()

# labels: comma-separated (e.g. ready-for-agent,client). `client` enables frontend-design in Sandcastle.
create_issue() {
  local key="$1"
  local title="$2"
  local labels_csv="$3"
  local body_file="$4"
  shift 4
  local -a blockers=("$@")

  local body
  body="$(cat "$body_file")"
  for blocker_key in "${blockers[@]}"; do
    if [[ -n "${NUM[$blocker_key]:-}" ]]; then
      body="${body//BLOCKER_${blocker_key}/#${NUM[$blocker_key]}}"
    fi
  done
  body="${body//BLOCKER_[0-9A-Z]*\n/}"
  if grep -q 'BLOCKER_' <<<"$body"; then
    echo "ERROR: unresolved blockers in $body_file" >&2
    grep 'BLOCKER_' <<<"$body" >&2
    exit 1
  fi

  local tmp
  tmp="$(mktemp)"
  printf '%s' "$body" >"$tmp"

  local -a gh_label_args=()
  local label
  IFS=',' read -ra label_list <<<"$labels_csv"
  for label in "${label_list[@]}"; do
    gh_label_args+=(--label "$label")
  done

  local url
  url="$(gh issue create --title "$title" "${gh_label_args[@]}" --body-file "$tmp")"
  rm -f "$tmp"

  local num="${url##*/}"
  NUM[$key]="$num"
  echo "Created #$num — $title"
}

create_issue "01" "ADR-0005: Custom in-process Compliance Evaluator" "human-in-the-loop" "$ISSUES_DIR/01-adr.md"

create_issue "02" "Compliance: compile Policy Version into Compiled Rule Set" "ready-for-agent" "$ISSUES_DIR/02-compile.md" "01"

create_issue "07A" "Compliance: Expense Report CSV import" "ready-for-agent,client" "$ISSUES_DIR/07a-expense-import.md" "01"

create_issue "07B" "Compliance: Expense Report browse" "ready-for-agent,client" "$ISSUES_DIR/07b-expense-browse.md" "07A"

create_issue "03" "Compliance: generate Rule Test Cases (positive and negative)" "ready-for-agent" "$ISSUES_DIR/03-test-pos-neg.md" "02"

create_issue "04" "Compliance: generate Rule Test Cases (boundary and exception)" "ready-for-agent" "$ISSUES_DIR/04-test-boundary-exception.md" "03"

create_issue "05" "Compliance: execute Rule Test Case run" "ready-for-agent,client" "$ISSUES_DIR/05-test-run.md" "04"

create_issue "06" "Compliance: disable Rule Test Case with rationale" "ready-for-agent,client" "$ISSUES_DIR/06-test-disable.md" "05"

create_issue "15" "Compliance: golden Rule Test Case corpus (CI)" "ready-for-agent" "$ISSUES_DIR/15-golden-test-corpus.md" "05"

create_issue "08A" "Compliance: Compliance Evaluation Run API (pass and violation)" "ready-for-agent" "$ISSUES_DIR/08a-eval-run-api.md" "02" "07A"

create_issue "08B" "Compliance: Compliance Evaluation Run client" "ready-for-agent,client" "$ISSUES_DIR/08b-eval-run-client.md" "08A"

create_issue "09" "Compliance: violation outcomes with Citation evidence" "ready-for-agent,client" "$ISSUES_DIR/09-violation-citation.md" "08B"

create_issue "10" "Compliance: needs_review for guidance and subjective Rules" "ready-for-agent,client" "$ISSUES_DIR/10-needs-review.md" "09"

create_issue "11" "Compliance: missing_evidence and Exception evidence gating" "ready-for-agent,client" "$ISSUES_DIR/11-missing-evidence.md" "10"

create_issue "12" "Compliance: multi-Rule outcome precedence" "ready-for-agent" "$ISSUES_DIR/12-precedence.md" "11"

create_issue "16" "Compliance: golden expense corpus and evaluation quality report" "ready-for-agent" "$ISSUES_DIR/16-golden-expense-report.md" "12"

create_issue "13" "Compliance: Compliance Review queue and review screen" "ready-for-agent,client" "$ISSUES_DIR/13-review-queue.md" "12"

create_issue "14A" "Compliance: Compliance Review decisions" "ready-for-agent,client" "$ISSUES_DIR/14a-review-decisions.md" "13"

create_issue "14B" "Compliance: Compliance Review audit trail" "ready-for-agent,client" "$ISSUES_DIR/14b-review-audit.md" "14A"

echo ""
echo "Published ${#NUM[@]} issues. Parent: #69"
printf '%s\n' "${NUM[@]}" | sort -n | xargs -I{} echo "https://github.com/Way2nnadi/claim-check/issues/{}"
