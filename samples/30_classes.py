# Title: Classes & objects
# Group: Classes
class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount
        return self.balance

    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError("Not enough money!")
        self.balance -= amount
        return self.balance

acct = BankAccount("Ada", 100)
acct.deposit(50)
acct.withdraw(30)
print(acct.owner, "has", acct.balance)
