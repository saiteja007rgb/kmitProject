import random
from locust import task, between
from locust.contrib.fasthttp import FastHttpUser

class CandidateUser(FastHttpUser):
    # Wait between 1 and 3 seconds between actions to simulate realistic human thinking
    wait_time = between(1, 3)

    def on_start(self):
        # 1. Login with a random candidate account (candidate_001 to candidate_100)
        cand_num = random.randint(1, 100)
        username = f"candidate_{cand_num:03d}"
        password = "password123"

        resp = self.client.post("/api/auth/login", json={"username": username, "password": password})
        if resp.status_code != 200:
            return

        self.token = resp.json().get("access_token")
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.session_id = None
        self.questions = []
        self.has_submitted = False

        # 2. Fetch active exam
        exam_resp = self.client.get("/api/exams", headers=self.headers)
        if exam_resp.status_code == 200 and len(exam_resp.json()) > 0:
            self.exam_id = exam_resp.json()[0]["id"]

            # 3. Start or resume exam session
            start_resp = self.client.post(f"/api/exams/{self.exam_id}/start", headers=self.headers)
            if start_resp.status_code == 200:
                self.session_id = start_resp.json()["session_id"]
                if start_resp.json()["status"] == "submitted":
                    self.has_submitted = True

                # 4. Fetch personalized questions
                q_resp = self.client.get(f"/api/sessions/{self.session_id}/questions", headers=self.headers)
                if q_resp.status_code == 200:
                    self.questions = q_resp.json()

    @task(6)
    def answer_question(self):
        """Simulates candidate answering/navigating questions with background autosave."""
        if not self.session_id or not self.questions or self.has_submitted:
            return

        q = random.choice(self.questions)
        choice = random.choice(["A", "B", "C", "D"])
        is_marked = random.random() < 0.2  # 20% chance to mark for review

        self.client.put(
            f"/api/sessions/{self.session_id}/answers/{q['id']}",
            headers=self.headers,
            json={
                "selected_answer": choice,
                "is_marked_for_review": is_marked,
                "version": 1
            },
            name="/api/sessions/[id]/answers/[qid]"
        )

    @task(1)
    def submit_exam(self):
        """Simulates candidate completing and submitting the examination."""
        if not self.session_id or self.has_submitted:
            return

        resp = self.client.post(
            f"/api/sessions/{self.session_id}/submit",
            headers=self.headers,
            name="/api/sessions/[id]/submit"
        )
        if resp.status_code == 200:
            self.has_submitted = True

