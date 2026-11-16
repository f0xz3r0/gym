"""Command-line entry point shared by model servers."""

import argparse
import logging
import os
from collections.abc import Callable, Sequence

import uvicorn

from model_server_sdk.server import ModelServer, create_app

# The studio polls every model server's /v1/info every 2 s; logging each poll grew each log by
# ~45 MB a day (2026-11-16). Successful polls are dropped; errors and every other request stay.
POLLING_PATHS = ("/v1/info",)


class QuietPolling(logging.Filter):
    """Drop uvicorn access lines for successful GETs of polling routes.

    ``paths`` match exactly; ``prefixes`` match the start of the path. The query string is ignored.
    A response of 400 or above is always kept.
    """

    def __init__(self, paths: Sequence[str] = POLLING_PATHS, prefixes: Sequence[str] = ()) -> None:
        super().__init__()
        self.paths = frozenset(paths)
        self.prefixes = tuple(prefixes)

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) != 5:
            return True
        _, method, path, _, status = args
        if method != "GET" or not isinstance(status, int) or status >= 400:
            return True
        path = str(path).split("?", 1)[0]
        return not (path in self.paths or path.startswith(self.prefixes))


def quiet_access_log(paths: Sequence[str] = POLLING_PATHS, prefixes: Sequence[str] = ()) -> None:
    """Install :class:`QuietPolling` on uvicorn's access logger (uvicorn's logging setup keeps it)."""
    logging.getLogger("uvicorn.access").addFilter(QuietPolling(paths, prefixes))


def serve(
    make_server: Callable[[argparse.Namespace], ModelServer],
    *,
    default_port: int,
    description: str,
    add_arguments: Callable[[argparse.ArgumentParser], None] | None = None,
    argv: Sequence[str] | None = None,
) -> None:
    """Parse ``--host``/``--port`` (plus server-specific options) and serve.

    ``MODEL_SERVER_HOST`` and ``MODEL_SERVER_PORT`` override the defaults.
    The server listens on loopback unless told otherwise.
    """
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--host", default=os.environ.get("MODEL_SERVER_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("MODEL_SERVER_PORT", default_port))
    )
    parser.add_argument("--log-level", default="info")
    if add_arguments is not None:
        add_arguments(parser)
    arguments = parser.parse_args(argv)
    logging.basicConfig(
        level=arguments.log_level.upper(), format="%(levelname)s %(name)s: %(message)s"
    )
    app = create_app(make_server(arguments))
    quiet_access_log()
    uvicorn.run(app, host=arguments.host, port=arguments.port, log_level=arguments.log_level)
