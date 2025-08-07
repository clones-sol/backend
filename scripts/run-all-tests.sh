#!/bin/bash

# Comprehensive Test Runner for Reward Pool System
# This script runs all tests in the correct order and provides detailed reporting

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "INFO")
            echo -e "${BLUE}[INFO]${NC} $message"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[SUCCESS]${NC} $message"
            ;;
        "WARNING")
            echo -e "${YELLOW}[WARNING]${NC} $message"
            ;;
        "ERROR")
            echo -e "${RED}[ERROR]${NC} $message"
            ;;
    esac
}

# Function to run a test and track results
run_test() {
    local test_name=$1
    local test_command=$2
    local timeout=${3:-300}  # Default 5 minutes timeout
    
    print_status "INFO" "Running $test_name..."
    echo "Command: $test_command"
    echo "Timeout: ${timeout}s"
    echo "----------------------------------------"
    
    local start_time=$(date +%s)
    
    if timeout $timeout bash -c "$test_command" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        print_status "SUCCESS" "$test_name completed successfully in ${duration}s"
        ((PASSED_TESTS++))
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        print_status "ERROR" "$test_name failed after ${duration}s"
        ((FAILED_TESTS++))
        return 1
    fi
    
    ((TOTAL_TESTS++))
    echo "----------------------------------------"
    echo
}

# Function to check prerequisites
check_prerequisites() {
    print_status "INFO" "Checking prerequisites..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_status "ERROR" "Node.js is not installed"
        exit 1
    fi
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        print_status "ERROR" "npm is not installed"
        exit 1
    fi
    
    # Check if Rust is installed
    if ! command -v cargo &> /dev/null; then
        print_status "ERROR" "Rust/Cargo is not installed"
        exit 1
    fi
    
    # Check if Solana CLI is installed
    if ! command -v solana &> /dev/null; then
        print_status "WARNING" "Solana CLI is not installed - some tests may fail"
    fi
    
    print_status "SUCCESS" "Prerequisites check completed"
}

# Function to setup test environment
setup_environment() {
    print_status "INFO" "Setting up test environment..."
    
    # Install dependencies
    print_status "INFO" "Installing npm dependencies..."
    npm install
    
    # Build the smart contract
    print_status "INFO" "Building smart contract..."
    npm run build:reward-pool
    
    print_status "SUCCESS" "Test environment setup completed"
}

# Function to run smart contract tests
run_smart_contract_tests() {
    print_status "INFO" "Starting Smart Contract Unit Tests..."
    
    # Run Rust unit tests
    run_test "Smart Contract Unit Tests" "cargo test --manifest-path programs/reward-pool/Cargo.toml" 120
    
    # Run audit script
    run_test "Smart Contract Audit" "npm run audit:smart-contract" 60
}

# Function to run backend API tests
run_backend_tests() {
    print_status "INFO" "Starting Backend API Tests..."
    
    # Run all backend tests
    run_test "Backend API Tests" "npm test" 300
    
    # Run specific API tests
    run_test "Reward Pool API Tests" "vitest src/api/forge/rewardPool.test.ts" 120
    run_test "Referral API Tests" "vitest src/api/referral.test.ts" 120
    run_test "Agents API Tests" "vitest src/api/forge/agents.test.ts" 120
}

# Function to run integration tests
run_integration_tests() {
    print_status "INFO" "Starting Integration Tests..."
    
    # Run Solana devnet integration tests
    run_test "Solana Devnet Integration Tests" "vitest src/api/forge/rewardPool.integration.test.ts" 300
    
    # Run complete reward flow tests
    run_test "Complete Reward Flow Tests" "vitest tests/reward-pool-integration.test.ts" 600
    
    # Run monitoring tests
    run_test "Monitoring System Tests" "vitest tests/monitoring.test.ts" 120
}

# Function to run performance tests
run_performance_tests() {
    print_status "INFO" "Starting Performance Tests..."
    
    # Run performance and load tests
    run_test "Performance Tests" "vitest tests/performance.test.ts" 300
    
    # Run gas optimization tests
    run_test "Gas Optimization Tests" "npm run test:reward-pool" 120
}

# Function to run security tests
run_security_tests() {
    print_status "INFO" "Starting Security Tests..."
    
    # Run security service tests
    run_test "Security Service Tests" "vitest src/services/security/crypto.test.ts" 60
    
    # Run edge case tests
    run_test "Edge Case Tests" "vitest tests/reward-pool-integration.test.ts --grep 'Error Handling and Edge Cases'" 300
    
    # Run security validation tests
    run_test "Security Validation Tests" "vitest tests/reward-pool-integration.test.ts --grep 'Security Tests'" 300
}

# Function to generate test report
generate_report() {
    print_status "INFO" "Generating test report..."
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    echo
    echo "========================================"
    echo "           TEST EXECUTION REPORT"
    echo "========================================"
    echo "Total Tests Run: $TOTAL_TESTS"
    echo "Passed: $PASSED_TESTS"
    echo "Failed: $FAILED_TESTS"
    echo "Success Rate: $((PASSED_TESTS * 100 / TOTAL_TESTS))%"
    echo "Total Duration: ${total_duration}s"
    echo "========================================"
    
    if [ $FAILED_TESTS -eq 0 ]; then
        print_status "SUCCESS" "All tests passed! 🎉"
        exit 0
    else
        print_status "ERROR" "$FAILED_TESTS test(s) failed"
        exit 1
    fi
}

# Function to cleanup
cleanup() {
    print_status "INFO" "Cleaning up test environment..."
    
    # Kill any remaining processes
    pkill -f "vitest" || true
    pkill -f "solana-test-validator" || true
    
    print_status "SUCCESS" "Cleanup completed"
}

# Main execution
main() {
    local start_time=$(date +%s)
    
    echo "========================================"
    echo "    REWARD POOL SYSTEM TEST SUITE"
    echo "========================================"
    echo "Starting comprehensive test execution..."
    echo
    
    # Set up trap to cleanup on exit
    trap cleanup EXIT
    
    # Run all test phases
    check_prerequisites
    setup_environment
    
    echo
    print_status "INFO" "Starting test execution phases..."
    echo
    
    # Phase 1: Smart Contract Tests
    run_smart_contract_tests
    
    # Phase 2: Backend API Tests
    run_backend_tests
    
    # Phase 3: Integration Tests
    run_integration_tests
    
    # Phase 4: Performance Tests
    run_performance_tests
    
    # Phase 5: Security Tests
    run_security_tests
    
    # Generate final report
    generate_report
}

# Handle command line arguments
case "${1:-all}" in
    "smart-contract")
        check_prerequisites
        setup_environment
        run_smart_contract_tests
        generate_report
        ;;
    "backend")
        check_prerequisites
        setup_environment
        run_backend_tests
        generate_report
        ;;
    "integration")
        check_prerequisites
        setup_environment
        run_integration_tests
        generate_report
        ;;
    "performance")
        check_prerequisites
        setup_environment
        run_performance_tests
        generate_report
        ;;
    "security")
        check_prerequisites
        setup_environment
        run_security_tests
        generate_report
        ;;
    "all"|*)
        main
        ;;
esac 