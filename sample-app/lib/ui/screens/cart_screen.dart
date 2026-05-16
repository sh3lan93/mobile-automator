import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/ui/screens/order_confirmation_screen.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  Future<void> _confirmRemove(
      BuildContext context, CartModel cart, String id) async {
    final remove = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove item?'),
        actions: [
          Semantics(
            identifier: 'cart_dialog_remove_cancel',
            button: true,
            child: TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel')),
          ),
          Semantics(
            identifier: 'cart_dialog_remove_confirm',
            button: true,
            child: TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Remove')),
          ),
        ],
      ),
    );
    if (remove == true) cart.remove(id);
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartModel>();

    return Scaffold(
      appBar: AppBar(title: const Text('Cart')),
      body: cart.isEmpty
          ? Center(
              child: Semantics(
                identifier: 'cart_empty_label',
                child: const Text('Your cart is empty.'),
              ),
            )
          : ListView(
              children: cart.lines.map((line) {
                final id = line.product.id;
                return Dismissible(
                  key: ValueKey('dismiss_$id'),
                  direction: DismissDirection.endToStart,
                  onDismissed: (_) =>
                      context.read<CartModel>().remove(id),
                  child: Semantics(
                    identifier: 'cart_item_$id',
                    child: GestureDetector(
                      onLongPress: () => _confirmRemove(
                          context, context.read<CartModel>(), id),
                      child: ListTile(
                        title: Text(line.product.title),
                        subtitle: Text('Qty ${line.qty}'),
                        trailing: Text(
                            '\$${(line.product.price * line.qty).toStringAsFixed(2)}'),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
      bottomNavigationBar: cart.isEmpty
          ? null
          : Padding(
              padding: const EdgeInsets.all(16),
              child: Semantics(
                identifier: 'cart_button_checkout',
                button: true,
                child: ElevatedButton(
                  onPressed: () {
                    context.read<CartModel>().clear();
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute<void>(
                          builder: (_) =>
                              const OrderConfirmationScreen()),
                    );
                  },
                  child: const Text('Checkout'),
                ),
              ),
            ),
    );
  }
}
