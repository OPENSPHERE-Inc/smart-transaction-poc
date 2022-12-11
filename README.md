# Smart Transaction for Symbol (PoC)

> 本リポジトリは実証コードにつき実用には堪えません。
> コードは整備されていない状態である事に留意してください。

## 1. 概要

### 1.1. Smart Transaction とは

Smart Transaction とは、マルチシグトランザクションの送り手と受け取り手でトランザクションの内容を検証するためのプロトコルで、
ブロックチェーンに格納された「Smart Transaction」と呼ばれる小規模なプログラムコードをお互いの環境で実行することで、
トランザクション結果の妥当性を検証できます。

Smart Transaction は [Metal on Symbol](https://github.com/OPENSPHERE-Inc/metal-on-symbol) 
を使ってブロックチェーンにデプロイされます。

Smart Transaction が実行されると、最終的にブロックチェーンを更新する Aggregate Transaction が生成されます。

取引の差出人は、まず Smart Transaction によって生成された Aggregate Transaction へ署名した「Signature」と 
Smart Transaction の入力データ（Call Data）を適切にエンコードして、
転送トランザクションのメッセージ（あるいはオフチェーンの通信手段）で取引相手に送ります。

このトランザクションを「Call Transaction」と呼びます。

Call Transaction を受け取った取引相手は、まず Call Transaction をデコードして検証し、
次に添付された Call Data を元に、同じ Smart Transaction を実行し、
出力された Aggregate Transaction に「連署」してアナウンスします。

Smart Transaction の実行結果と双方の Signature が正しければ、ブロックチェーン上でトランザクションが承認され、
取引が成立するという仕組みです（無論、Signature が不正であれば承認されません）

更なる連署が必要なトランザクションでは、関係人物全員が一様に Smart Transaction を実行し連署する事になるでしょう。

> 何となく「Smart Contract」と似たような雰囲気ですが、Smart Transaction あくまでも他者間の合意形成（の手助け）が基本機能になります。
> 従って Smart Transaction の実行結果をブロックチェーンに反映するには、最終的に取引関係者の承認（署名）が必要になります。

### 1.2. 技術的特性

Aggregate Transaction は（特に Aggregate Bonded Transaction では）、
セキュリティ上の要求から、必ず署名する前にトランザクションの内容をチェックする必要があります。
現在はチェックが人間の目で行われる事を想定しています。
自身がどのような取引を行うのか理解したうえで署名することが求められます。
そうでなければ詐欺に引っかかり、資産を失う結果になりかねないでしょう。

Smart Transaction ではこのチェックを、予めブロックチェーン上で定義したルールに従って行う事で、自動化することを目的とします。
従って、複雑・巨大な Aggregate Transaction であっても、安全に実行することが可能になります。

なぜならば Call Transaction ではトランザクションペイロードを添付せず、代わりに Signature のみが添付されるためです。
トランザクションペイロードを入手するには Smart Transaction を実行する他なく、
Smart Transaction から取引相手と同一の結果が得られなければ Signature が一致せず、取引は絶対に成立しません。
このことは署名だけで取引が成立してしまう従来の Aggregate Bonded Transaction と明確に異なる、優れたセキュリティ特性を有します。

## 2. Smart Transaction 仕様

- Smart Transaction はブロックチェーン上のリソースにアクセス（読み出し）可能である
- Smart Transaction はリモートおよびローカルを含むオフチェーンリソースには直接アクセス不可である
- Smart Transaction にオフチェーンの情報を渡すには入力データとして渡す他ない
- Smart Transaction の出力は Aggregate Transaction（のシリアライズされたペイロード）である。
- （本 PoC では）Smart Transaction の実体は wasm としてデプロイされるものとする。

## 3. Call Transaction 仕様

- Transaction Hash
- Deadline
- Max Fee
- Signer Public Key
- Signature
- Cosignatures
- Call Data





