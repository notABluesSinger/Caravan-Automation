import unittest
from unittest import mock

from scripts import put_script


class EnsureScriptTests(unittest.TestCase):
    def test_existing_script_keeps_requested_id(self):
        with mock.patch.object(put_script, "call_rpc", return_value={"name": "toiletLight.js"}) as call_rpc:
            script_id, exists = put_script.ensure_script("192.168.4.54", 0, "toiletLight.js")

        self.assertEqual(script_id, 0)
        self.assertTrue(exists)
        call_rpc.assert_called_once_with("192.168.4.54", "Script.GetConfig", {"id": 0})

    def test_missing_script_creates_new_script(self):
        missing = put_script.RpcError(
            "Script.GetConfig",
            "Argument 'id', value 0 not found!",
            status_code=500,
            error_code=-105,
        )

        with mock.patch("builtins.print"):
            with mock.patch.object(
                put_script,
                "call_rpc",
                side_effect=[missing, {"scripts": []}, {"id": 1}],
            ) as call_rpc:
                script_id, exists = put_script.ensure_script("192.168.4.54", 0, "toiletLight.js")

        self.assertEqual(script_id, 1)
        self.assertFalse(exists)
        self.assertEqual(
            call_rpc.call_args_list,
            [
                mock.call("192.168.4.54", "Script.GetConfig", {"id": 0}),
                mock.call("192.168.4.54", "Script.List", {}),
                mock.call("192.168.4.54", "Script.Create", {"name": "toiletLight.js"}),
            ],
        )

    def test_missing_script_reuses_existing_name(self):
        missing = put_script.RpcError(
            "Script.GetConfig",
            "Argument 'id', value 0 not found!",
            status_code=500,
            error_code=-105,
        )

        with mock.patch("builtins.print"):
            with mock.patch.object(
                put_script,
                "call_rpc",
                side_effect=[missing, {"scripts": [{"id": 1, "name": "toiletLight.js"}]}],
            ) as call_rpc:
                script_id, exists = put_script.ensure_script("192.168.4.54", 0, "toiletLight.js")

        self.assertEqual(script_id, 1)
        self.assertTrue(exists)
        self.assertEqual(
            call_rpc.call_args_list,
            [
                mock.call("192.168.4.54", "Script.GetConfig", {"id": 0}),
                mock.call("192.168.4.54", "Script.List", {}),
            ],
        )

    def test_unexpected_rpc_error_is_not_swallowed(self):
        failure = put_script.RpcError(
            "Script.GetConfig",
            "permission denied",
            status_code=403,
            error_code=-1,
        )

        with mock.patch.object(put_script, "call_rpc", side_effect=failure):
            with self.assertRaises(put_script.RpcError):
                put_script.ensure_script("192.168.4.54", 0, "toiletLight.js")

    def test_configure_script_sets_name_and_enables_autostart(self):
        with mock.patch.object(put_script, "call_rpc", return_value={}) as call_rpc:
            put_script.configure_script("192.168.4.54", 1, "toiletLight.js")

        call_rpc.assert_called_once_with(
            "192.168.4.54",
            "Script.SetConfig",
            {"id": 1, "config": {"name": "toiletLight.js", "enable": True}},
        )


if __name__ == "__main__":
    unittest.main()
