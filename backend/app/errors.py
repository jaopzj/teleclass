"""Erro de aplicação com código estável, mensagem para a pessoa e campo afetado.

As rotas respondem `{"detail": mensagem, "code": código, "field": campo}`. O
frontend decide o que mostrar pelo `code` e exibe a mensagem perto do `field`.
As mensagens nunca incluem dados sensíveis (códigos, senhas, sessões).
"""

from __future__ import annotations


class AppError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        field: str | None = None,
        retry_after: int | None = None,
        extra: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.retry_after = retry_after
        self.extra = extra or {}

    def to_dict(self) -> dict:
        body: dict = {"detail": self.message, "code": self.code}
        if self.field:
            body["field"] = self.field
        if self.retry_after is not None:
            body["retry_after"] = self.retry_after
        body.update(self.extra)
        return body
