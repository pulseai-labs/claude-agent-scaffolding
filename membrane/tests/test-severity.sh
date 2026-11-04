#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/severity.sh"

_csa_failed=0

test_severity_critical_rank() { assert_eq "5" "$(csa_severity_rank critical)"; }
test_severity_high_rank()     { assert_eq "4" "$(csa_severity_rank high)"; }
test_severity_medium_rank()   { assert_eq "3" "$(csa_severity_rank medium)"; }
test_severity_low_rank()      { assert_eq "2" "$(csa_severity_rank low)"; }
test_severity_info_rank()     { assert_eq "1" "$(csa_severity_rank info)"; }
test_severity_unknown_returns_zero() { assert_eq "0" "$(csa_severity_rank bogus)"; }
test_severity_compare_critical_gt_low() { assert_eq "1"  "$(csa_severity_compare critical low)"; }
test_severity_compare_low_lt_high()      { assert_eq "-1" "$(csa_severity_compare low high)"; }
test_severity_compare_equal()            { assert_eq "0"  "$(csa_severity_compare high high)"; }
test_severity_valid_accepts_known()      { csa_severity_valid critical; }
test_severity_valid_rejects_unknown()    { ! csa_severity_valid bogus; }

csa_test_run test_severity_critical_rank          || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_high_rank              || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_medium_rank            || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_low_rank               || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_info_rank              || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_unknown_returns_zero   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_compare_critical_gt_low || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_compare_low_lt_high    || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_compare_equal          || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_valid_accepts_known    || _csa_failed=$((_csa_failed + 1))
csa_test_run test_severity_valid_rejects_unknown  || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
