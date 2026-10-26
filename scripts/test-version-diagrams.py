"""Documentation diagrams are non-release; shipped templates retain precedence."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('mw_version', pathlib.Path(__file__).with_name('mw-version.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class DiagramPaths(unittest.TestCase):
    def test_documentation_sources_and_images_are_exempt(self):
        paths = {'diagrams/action.mmd', 'diagrams/action.excalidraw', 'diagrams/action.svg', 'diagrams/action.png'}
        self.assertEqual(policy.release_changes(paths, {}), set())

    def test_exemption_does_not_hide_product_sources_or_explicit_release_paths(self):
        paths = {'src/action.mmd', 'src/action.excalidraw', 'templates/lit-node/README.md'}
        self.assertEqual(policy.release_changes(paths, {'release_paths': ['templates/lit-*/**']}), paths)
        self.assertEqual(policy.release_changes({'diagrams/shipped.mmd'}, {'release_paths': ['diagrams/shipped.mmd']}), {'diagrams/shipped.mmd'})

if __name__ == '__main__':
    unittest.main()
