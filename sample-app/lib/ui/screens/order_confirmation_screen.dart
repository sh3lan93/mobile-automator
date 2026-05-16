import 'package:flutter/material.dart';

class OrderConfirmationScreen extends StatelessWidget {
  const OrderConfirmationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Order')),
      body: Center(
        child: Semantics(
          identifier: 'order_confirmation_label',
          child: const Text('Order placed. Thanks for your order!'),
        ),
      ),
    );
  }
}
