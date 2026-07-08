import importlib
import os
import tempfile
import unittest


class MessagesApiTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.data_path = os.path.join(self.tempdir.name, "messages.json")
        os.environ["CONTACT_DATA_FILE"] = self.data_path
        import app

        app_module = importlib.reload(app)
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_post_and_get_messages(self):
        response = self.client.post(
            "/api/messages",
            json={"name": "Nic", "message": "Hello from tests"},
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.get("/api/messages")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(len(data["messages"]), 1)
        self.assertEqual(data["messages"][0]["name"], "Nic")


if __name__ == "__main__":
    unittest.main()
