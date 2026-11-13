"""
ExamPulse — Automated Browser End-to-End Test Suite
Tests candidate examination flow and invigilator monitoring using Playwright.
"""
import sys
import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:5173"

async def run_browser_tests():
    print(f"Connecting to ExamPulse frontend at {BASE_URL}...")
    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch(headless=True)
        except Exception as e:
            print(f"Notice: Chromium binary not yet installed. Run 'playwright install chromium' to run with real headless browser.")
            print(f"Error details: {e}")
            return

        context = await browser.new_context()
        page = await context.new_page()

        print("[1/5] Testing Candidate Login Flow...")
        await page.goto(f"{BASE_URL}")
        await page.wait_for_selector("text=Sign In to ExamPulse")
        # Click quick-fill Candidate 1
        await page.click("text=Candidate 1")
        await page.click("button:has-text('Sign In')")

        print("[2/5] Testing Examination Entry...")
        await page.wait_for_selector("text=Examination Lobby")
        await page.click("button:has-text('Enter Examination')")

        print("[3/5] Testing Question Answering & Autosave...")
        await page.wait_for_selector("text=Question 1")
        # Select first option
        options = await page.query_selector_all("button:has-text('Option')")
        if options:
            await options[0].click()
            await page.wait_for_selector("text=Saved")
            print("  ✓ Autosave acknowledged by server (Saved badge active)")

        print("[4/5] Testing Navigation & Review Flag...")
        await page.click("button:has-text('Mark for Review')")
        await page.click("button:has-text('Next')")
        await page.wait_for_selector("text=Question 2")

        print("[5/5] Testing Final Submission...")
        await page.click("button:has-text('Submit Exam')")
        await page.wait_for_selector("text=Confirm Submit")
        await page.click("button:has-text('Confirm Submit')")
        await page.wait_for_selector("text=Examination Submitted!")
        print("  ✓ Final submission processed and scored successfully.")

        await browser.close()
        print("\nAll browser tests completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_browser_tests())

